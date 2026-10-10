import { createBucket } from './bucket.js';

// Хранилище корзин в памяти процесса. Простаивающие корзины удаляются по таймеру,
// иначе Map растёт на каждый новый ключ (ботнет с тысячами IP).

export class MemoryStore {
  constructor({ capacity, refillPerSec, idleMs = 10 * 60 * 1000, clock = Date.now }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.idleMs = idleMs;
    this.clock = clock;
    this.buckets = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(idleMs, 60_000));
    this.timer.unref();
  }

  get(key) {
    const now = this.clock();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = createBucket(this.capacity, this.refillPerSec, now);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  sweep() {
    const now = this.clock();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > this.idleMs) this.buckets.delete(key);
    }
  }

  close() {
    clearInterval(this.timer);
  }
}
