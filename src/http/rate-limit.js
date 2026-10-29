// Fixed-window failure counter for login attempts, per client IP and globally.
// The global cap stops brute force even if an attacker rotates IPs or spoofs proxy headers.

export function loginLimiter({ perIp = 5, global = 50, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const failures = new Map(); // ip -> { count, resetAt }
  let globalWindow = { count: 0, resetAt: 0 };

  const current = (entry) => (entry && entry.resetAt > now() ? entry : { count: 0, resetAt: now() + windowMs });

  return {
    isBlocked(ip) {
      return current(failures.get(ip)).count >= perIp || current(globalWindow).count >= global;
    },

    recordFailure(ip) {
      const entry = current(failures.get(ip));
      failures.set(ip, { ...entry, count: entry.count + 1 });
      globalWindow = current(globalWindow);
      globalWindow.count += 1;
      // Drop expired entries so the map cannot grow without bound.
      if (failures.size > 10_000) {
        for (const [key, value] of failures) if (value.resetAt <= now()) failures.delete(key);
      }
    },

    recordSuccess(ip) {
      failures.delete(ip);
    },
  };
}
