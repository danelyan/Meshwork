'use client';

import { type ReactNode, useRef } from 'react';

import { TelemetryMount } from '@/components/chat/TelemetryMount';

import { AsideProvider } from '../consultant/aside-refresh';
import { SceneAside } from '../consultant/SceneAside';
import { SceneStats } from '../consultant/SceneStats';
import type { SceneAsideData } from '@/server/consultant/aside';

import { Chat } from '../Chat';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';

import { CallPanel } from '../call/CallPanel';
import type { CallKind } from '@/server/call/types';

import { CallProvider, useCallMode } from '../call/CallContext';
import { HeadView } from './HeadView';
import { PanelSplitter } from './PanelSplitter';
import { MuteToggle, StateChip, StopButton, Subtitles } from './Speaking';
import { CompanionVoiceProvider } from './voice';
import styles from './AvatarScene.module.css';

export type AvatarSceneVariant = 'portrait' | 'inline' | 'call' | 'call-side';

/**
 * Сцены консультанта с нашей головой (варианты экрана для выбора). Сцена держит свой
 * `CompanionVoiceProvider` с автовключением озвучки на первом действии; лента `Chat` внутри
 * подхватывает его, а не создаёт свой. ConsultantScene Карины не затронут.
 *  - `portrait` — «Портрет-собеседник»: сетка 44/56, справа липкий портрет с субтитрами;
 *  - `inline` — «Голова в ленте»: липкая голова ~160px над лентой, без правой колонки;
 *  - `call` — «Видеозвонок»: голова крупно по центру, лента — полупрозрачный транскрипт снизу;
 *  - `call-side` — «Звонок + чат слева» (D = C + A): тёмный экран звонка, слева светлая панель чата
 *    на всю высоту с полной лентой и вводом; уже 1050px — панель снизу, голова сверху ~40vh.
 * `label` — подпись у головы («Помощник по подбору» у работодателя).
 * `aside` — данные правой колонки call-side под головой («Твой путь», «Документы», «Подсказка»,
 * components/consultant/SceneAside; считаются на сервере в page.tsx).
 * `children` — готовая лента (слитая лента /consultant: онбординг + консультант, см.
 * components/consultant/ConsultantFeed); без них сцена рисует обычный `Chat`.
 */
export function AvatarScene({ variant, demo, initial, children, aside, label = 'ИИ-консультант', call = false, callKind, callOpen }: { variant: AvatarSceneVariant; label?: string; demo?: ChatDemoContext; initial?: RestoredChat; children?: ReactNode; aside?: SceneAsideData; call?: boolean; callKind?: CallKind; callOpen?: boolean }) {
  const feed = (className?: string) => children ?? <Chat demo={demo} initial={initial} className={className} />;
  const scene = (
    <CompanionVoiceProvider autoEnable>
      <AsideProvider initial={aside}>
      {/* Телеметрия чата (docs/platform.md): без флага ничего не рисует; вне сцен — fixed не зависит от их раскладки. */}
      <TelemetryMount />
      {variant === 'portrait' && (
        <div className={styles.portraitScene} data-testid="scene-portrait">
          <div className={styles.conversation}>
            {feed()}
          </div>
          <aside className={styles.portrait} aria-label={label}>
            <HeadView />
            <span className={styles.badge}>{label}</span>
            <div className={styles.callTop}>
              <MuteToggle />
            </div>
            <div className={styles.under}>
              <StateChip />
              <Subtitles />
            </div>
          </aside>
        </div>
      )}
      {variant === 'inline' && (
        <div className={styles.inlineScene} data-testid="scene-inline">
          <div className={styles.dock}>
            <div className={styles.dockHead}>
              <HeadView />
            </div>
            <div className={styles.dockInfo}>
              <span className={styles.dockName}>ИИ-консультант</span>
              <StateChip className={styles.dockChip} />
              <div className={styles.dockButtons}>
                <MuteToggle />
                <StopButton />
              </div>
            </div>
          </div>
          <div className={styles.inlineChat}>
            {children ? <div className={styles.feedBox}>{children}</div> : feed(styles.inlineChatBox)}
          </div>
        </div>
      )}
      {variant === 'call' && (
        <div className={styles.callScene} data-testid="scene-call">
          <div className={styles.callHead}>
            <HeadView />
            <span className={styles.badge}>{label}</span>
            <div className={styles.callTop}>
              <StateChip />
              <MuteToggle />
            </div>
            <div className={styles.callStop}>
              <StopButton />
            </div>
          </div>
          <div className={styles.callTranscript}>
            {children ? <div className={styles.feedBox}>{children}</div> : feed(styles.callChat)}
          </div>
        </div>
      )}
      {variant === 'call-side' && <SideScene label={label} aside={aside}>{feed(styles.sideChat)}</SideScene>}
      </AsideProvider>
    </CompanionVoiceProvider>
  );
  // Режим звонка (lane call): только у кандидата; провайдер снаружи голоса, чтобы кнопка в ленте его видела.
  return call ? <CallProvider kind={callKind} initialOpen={callOpen}>{scene}</CallProvider> : scene;
}

/** Сцена «звонок + чат слева»; открыт созвон — сцена становится панелью звонка, лента неактивна. */
function SideScene({ label, aside, children }: { label: string; aside?: SceneAsideData; children: ReactNode }) {
  const call = useCallMode();
  const inCall = Boolean(call?.open);
  // Тема — на <html> (components/shell/theme.ts), сцена следует ей через [data-scene]; тёмная только панель звонка
  // (data-call на sideStage, tokens.css); на корне data-in-call — режим звонка для раскладки и приглушения чата.
  const sceneRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={sceneRef} className={`${styles.sideScene}${aside ? ` ${styles.withAside}` : ''}`} data-testid="scene-call-side" data-in-call={inCall || undefined} data-scene>
      <PanelSplitter scene={sceneRef} />
      <section className={styles.sideStage} aria-label={label} data-call={inCall || undefined}>
        {inCall ? (
          <CallPanel />
        ) : (
          <>
            <div className={`${styles.sideHead}${aside?.stats?.length ? ` ${styles.withStats}` : ''}`}>
              <div className={styles.headBox}>
                <HeadView />
              </div>
              {aside?.stats?.length ? <SceneStats initial={aside} className={styles.sideStats} /> : null}
              <span className={styles.badge}>{label}</span>
              <div className={styles.callTop}>
                <StateChip />
                <MuteToggle />
              </div>
              <div className={styles.callStop}>
                <StopButton />
              </div>
            </div>
            <Subtitles className={styles.sideSubs} />
          </>
        )}
      </section>
      {aside && <SceneAside data={aside} className={styles.sideAside} />}
      <div className={styles.sidePanel} data-testid="side-panel" data-feed-scroll inert={inCall || undefined} aria-hidden={inCall || undefined}>
        {inCall && <p className={styles.callPause}>Идёт созвон - чат на паузе</p>}
        {children}
      </div>
    </div>
  );
}
