/**
 * Выбор устройства ввода после шага «Проверка устройств». Хранится в памяти вкладки (не в localStorage:
 * deviceId привязан к источнику и меняется при сбросе разрешений). Хуки микрофона подмешивают его в
 * constraints как `ideal`, поэтому отключённое устройство не ломает getUserMedia (OverconstrainedError).
 */
let micId: string | null = null;

export function setMicDeviceId(id: string | null) {
  micId = id || null;
}

export function getMicDeviceId(): string | null {
  return micId;
}

/** Фрагмент audio-constraints с выбранным устройством (пустой, если выбор не делали). */
export function micDeviceConstraint(): { deviceId?: { ideal: string } } {
  return micId ? { deviceId: { ideal: micId } } : {};
}
