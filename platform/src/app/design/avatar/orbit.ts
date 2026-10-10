/** Ручной поворот головы мышью: drag меняет yaw/pitch, после отпускания — инерция с затуханием. */
export interface OrbitAngles {
  yaw: number;
  pitch: number;
}

const YAW_LIMIT = 1.4;
const PITCH_LIMIT = 0.7;
const DRAG_YAW = 0.008;
const DRAG_PITCH = 0.006;
const DECAY_PER_SEC = 4;

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

export class OrbitState {
  private yaw = 0;
  private pitch = 0;
  private vYaw = 0;
  private vPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;

  begin(x: number, y: number, now: number): void {
    this.dragging = true;
    this.lastX = x;
    this.lastY = y;
    this.lastT = now;
    this.vYaw = 0;
    this.vPitch = 0;
  }

  drag(x: number, y: number, now: number): void {
    if (!this.dragging) return;
    const dYaw = (x - this.lastX) * DRAG_YAW;
    const dPitch = (y - this.lastY) * DRAG_PITCH;
    const dt = Math.max(0.001, (now - this.lastT) / 1000);
    this.yaw = clamp(this.yaw + dYaw, YAW_LIMIT);
    this.pitch = clamp(this.pitch + dPitch, PITCH_LIMIT);
    this.vYaw = dYaw / dt;
    this.vPitch = dPitch / dt;
    this.lastX = x;
    this.lastY = y;
    this.lastT = now;
  }

  end(now: number): void {
    // курсор стоял перед отпусканием — инерции нет
    if (now - this.lastT > 80) {
      this.vYaw = 0;
      this.vPitch = 0;
    }
    this.dragging = false;
    this.lastT = now;
  }

  nudge(dYaw: number, dPitch: number): void {
    this.yaw = clamp(this.yaw + dYaw, YAW_LIMIT);
    this.pitch = clamp(this.pitch + dPitch, PITCH_LIMIT);
  }

  reset(): void {
    this.yaw = this.pitch = this.vYaw = this.vPitch = 0;
  }

  /** Текущие углы; вызывается каждый кадр — применяет инерцию, если голову не держат. */
  read(now: number): OrbitAngles {
    if (!this.dragging && (Math.abs(this.vYaw) > 0.01 || Math.abs(this.vPitch) > 0.01)) {
      const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
      this.yaw = clamp(this.yaw + this.vYaw * dt, YAW_LIMIT);
      this.pitch = clamp(this.pitch + this.vPitch * dt, PITCH_LIMIT);
      const k = Math.exp(-DECAY_PER_SEC * dt);
      this.vYaw *= k;
      this.vPitch *= k;
      this.lastT = now;
    }
    return { yaw: this.yaw, pitch: this.pitch };
  }
}
