'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { signalApi } from '@/lib/defense-room-api';
import type { SignalPayload } from '@/server/defense-room/types';

/**
 * P2P-аудио защиты (ADR 0003): WebRTC между кандидатом и подключившимся работодателем, сигналинг —
 * POST /api/call/{id}/signal и SSE `signal`. Паттерн «perfect negotiation» (MDN, WebRTC API):
 * кандидат — вежливая сторона (уступает при встречных offer), работодатель — нет.
 * Только публичный STUN, TURN нет: если ICE не соединился за ICE_TIMEOUT_MS или ушёл в failed —
 * состояние `failed`, интерфейс пишет «аудио недоступно, текст» и разговор идёт текстом/TTS.
 */
export type RtcState = 'off' | 'connecting' | 'connected' | 'failed';

export const ICE_TIMEOUT_MS = 15_000;

interface Peer {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  audio: HTMLAudioElement;
}

export interface RtcAudio {
  /** Состояние по собеседникам: ключ — peerId (`candidate` или `employer:<userId>`). */
  states: Record<string, RtcState>;
  /** Есть ли хотя бы одно поднятое аудио. */
  anyConnected: boolean;
  micError: string | null;
  /** Входящий сигнал из SSE. */
  onSignal: (from: string, payload: SignalPayload) => void;
  /** Поднять соединение с собеседником (работодатель зовёт для `candidate`; кандидат — на participant_joined). */
  connect: (peer: string) => void;
  close: (peer: string) => void;
  closeAll: () => void;
}

export function useRtcAudio(sessionId: string, role: 'candidate' | 'employer', iceServers: RTCIceServer[], enabled: boolean): RtcAudio {
  const peers = useRef(new Map<string, Peer>());
  const streamRef = useRef<Promise<MediaStream | null> | null>(null);
  const [states, setStates] = useState<Record<string, RtcState>>({});
  const [micError, setMicError] = useState<string | null>(null);
  const polite = role === 'candidate';

  const setState = useCallback((peer: string, s: RtcState) => setStates((prev) => (prev[peer] === s ? prev : { ...prev, [peer]: s })), []);

  const mic = useCallback(() => {
    streamRef.current ??= navigator.mediaDevices
      ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .catch(() => {
        setMicError('Нет доступа к микрофону - собеседник вас не услышит, остаётся текст');
        return null;
      }) ?? Promise.resolve(null);
    return streamRef.current;
  }, []);

  const send = useCallback(
    (peer: string, body: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit | null }) =>
      signalApi(sessionId, { ...(role === 'candidate' ? { to: peer } : {}), ...body }).catch(() => {
        /* собеседник не на связи — таймаут ICE переведёт в текст */
      }),
    [sessionId, role],
  );

  const fail = useCallback(
    (peer: string) => {
      const p = peers.current.get(peer);
      if (p) {
        if (p.timer) clearTimeout(p.timer);
        p.pc.close();
        p.audio.srcObject = null;
        peers.current.delete(peer);
      }
      setState(peer, 'failed');
    },
    [setState],
  );

  const ensure = useCallback(
    (peer: string): Peer => {
      const existing = peers.current.get(peer);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers });
      const audio = new Audio();
      audio.autoplay = true;
      const p: Peer = { pc, makingOffer: false, ignoreOffer: false, timer: null, audio };
      peers.current.set(peer, p);
      setState(peer, 'connecting');
      p.timer = setTimeout(() => {
        if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') fail(peer);
      }, ICE_TIMEOUT_MS);
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) void send(peer, { ice: candidate.toJSON() });
      };
      pc.ontrack = ({ streams }) => {
        if (streams[0]) {
          audio.srcObject = streams[0];
          void audio.play().catch(() => undefined);
        }
      };
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === 'connected' || s === 'completed') {
          if (p.timer) clearTimeout(p.timer);
          setState(peer, 'connected');
        } else if (s === 'failed') fail(peer);
        else if (s === 'disconnected') setState(peer, 'connecting');
      };
      pc.onnegotiationneeded = async () => {
        try {
          p.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) void send(peer, { sdp: pc.localDescription.toJSON() });
        } catch {
          fail(peer);
        } finally {
          p.makingOffer = false;
        }
      };
      // Звонит работодатель (невежливая сторона): его addTrack запускает negotiationneeded → offer.
      // Кандидат добавляет микрофон, только получив offer (onSignal), чтобы не было встречных offer.
      if (!polite) {
        void mic().then((stream) => {
          if (!stream || pc.signalingState === 'closed') return;
          addTracks(pc, stream);
        });
      }
      return p;
    },
    [iceServers, mic, send, setState, fail, polite],
  );

  const onSignal = useCallback(
    async (from: string, payload: SignalPayload) => {
      if (!enabled) return;
      const p = ensure(from);
      const { pc } = p;
      try {
        if (payload.description) {
          const d = payload.description;
          const offerCollision = d.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
          p.ignoreOffer = !polite && offerCollision;
          if (p.ignoreOffer) return;
          await pc.setRemoteDescription(d as RTCSessionDescriptionInit);
          if (d.type === 'offer') {
            // Микрофон до ответа: addTrack займёт трансивер из offer, ответ будет sendrecv.
            const stream = await mic();
            if (stream) addTracks(pc, stream);
            await pc.setLocalDescription();
            if (pc.localDescription) void send(from, { sdp: pc.localDescription.toJSON() });
          }
        } else if (payload.candidate) {
          try {
            await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
          } catch (err) {
            if (!p.ignoreOffer) throw err;
          }
        }
      } catch {
        fail(from);
      }
    },
    [enabled, ensure, mic, polite, send, fail],
  );

  const connect = useCallback(
    (peer: string) => {
      if (!enabled || typeof RTCPeerConnection === 'undefined') {
        setState(peer, 'failed');
        return;
      }
      ensure(peer);
    },
    [enabled, ensure, setState],
  );

  const close = useCallback(
    (peer: string) => {
      const p = peers.current.get(peer);
      if (!p) return;
      if (p.timer) clearTimeout(p.timer);
      p.pc.close();
      p.audio.srcObject = null;
      peers.current.delete(peer);
      setState(peer, 'off');
    },
    [setState],
  );

  const closeAll = useCallback(() => {
    for (const k of [...peers.current.keys()]) close(k);
    void streamRef.current?.then((s) => s?.getTracks().forEach((t) => t.stop()));
    streamRef.current = null;
  }, [close]);

  useEffect(() => () => closeAll(), [closeAll]);

  return {
    states,
    anyConnected: Object.values(states).includes('connected'),
    micError,
    onSignal: (from, payload) => void onSignal(from, payload),
    connect,
    close,
    closeAll,
  };
}

function addTracks(pc: RTCPeerConnection, stream: MediaStream): void {
  for (const track of stream.getAudioTracks()) {
    if (pc.getSenders().some((s) => s.track === track)) continue;
    try {
      pc.addTrack(track, stream);
    } catch {
      /* соединение закрыто */
    }
  }
}

/** Подпись состояния аудио для интерфейса. */
export function rtcLabel(s: RtcState | undefined): string {
  switch (s) {
    case 'connecting':
      return 'аудио соединяется…';
    case 'connected':
      return 'аудио P2P на связи';
    case 'failed':
      return 'аудио недоступно, текст';
    default:
      return 'аудио выключено';
  }
}
