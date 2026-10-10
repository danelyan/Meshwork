const BASE_MS = 500;
const MAX_MS = 60_000;
const MAX_ATTEMPTS = 8;

export function backoffMs(attempt, random = Math.random) {
  const exp = Math.min(MAX_MS, BASE_MS * 2 ** attempt);
  return Math.floor(random() * exp);
}

export class RetryQueue {
  constructor({ deliver, schedule = setTimeout, random = Math.random }) {
    this.deliver = deliver;
    this.schedule = schedule;
    this.random = random;
    this.dead = [];
    this.inFlight = new Set();
  }

  enqueue(event, attempt = 0) {
    if (this.inFlight.has(event.id) && attempt === 0) return false;
    this.inFlight.add(event.id);
    this.schedule(() => this.run(event, attempt), attempt === 0 ? 0 : backoffMs(attempt, this.random));
    return true;
  }

  async run(event, attempt) {
    try {
      const res = await this.deliver(event);
      if (res.status >= 500 || res.status === 429) throw new Error(`status ${res.status}`);
      this.inFlight.delete(event.id);
    } catch (err) {
      if (attempt + 1 >= MAX_ATTEMPTS) {
        this.inFlight.delete(event.id);
        this.dead.push({ event, error: String(err) });
        return;
      }
      this.enqueue(event, attempt + 1);
    }
  }
}
