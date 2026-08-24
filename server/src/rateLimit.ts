// Login throttle. In-memory is enough: the server is a single process, and
// keying on the (lowercased) account name protects the thing that actually
// matters — a code or password being guessed — regardless of proxies mangling
// client IPs.

interface Window {
  failures: number;
  windowStart: number;
}

export class LoginRateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private max = 10,
    private windowMs = 15 * 60_000,
    private now: () => number = Date.now,
  ) {}

  /** Record an attempt; false = throttled, reject before checking anything. */
  attempt(rawKey: string): boolean {
    const key = rawKey.toLowerCase();
    const at = this.now();
    this.prune(at);
    const win = this.windows.get(key);
    if (!win || at - win.windowStart >= this.windowMs) {
      this.windows.set(key, { failures: 1, windowStart: at });
      return true;
    }
    win.failures += 1;
    return win.failures <= this.max;
  }

  /** A successful login clears the account's window. */
  succeed(rawKey: string): void {
    this.windows.delete(rawKey.toLowerCase());
  }

  private prune(at: number): void {
    for (const [key, win] of this.windows) {
      if (at - win.windowStart >= this.windowMs) this.windows.delete(key);
    }
  }
}
