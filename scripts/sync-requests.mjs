/**
 * Requests under one key (a player and a scene), answered at most once per window: the first at
 * once, and any more inside the window as one follow-up when it ends (with the latest arguments).
 * Nothing is dropped: a request inside the window is always answered by that follow-up.
 */
export function requestCoalescer(run, { windowMs = 2000, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  const keys = new Map();
  const fire = (entry) => { entry.until = now() + windowMs; run(...entry.args); };
  return (key, ...args) => {
    let entry = keys.get(key);
    if (!entry) keys.set(key, entry = { until: -Infinity, waiting: false, args });
    entry.args = args;
    if (entry.waiting) return;
    if (now() >= entry.until) return fire(entry);
    entry.waiting = true;
    schedule(() => { entry.waiting = false; fire(entry); }, Math.max(0, entry.until - now()));
  };
}
