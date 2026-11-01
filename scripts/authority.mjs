/** One connected GM owns shared journey operations. The user list's order is the fallback. */
export function primaryGM(game = globalThis.game) {
  const users = Array.from(game?.users ?? []), connected = users.filter((u) => u.isGM && u.active);
  let selected = "";
  try { selected = game.settings.get("kg-realms", "primaryGM") ?? ""; } catch { /* init */ }
  return connected.find((u) => u.id === selected) ?? connected[0] ?? null;
}

export function isPrimaryGM(game = globalThis.game) {
  if (!game?.user?.isGM) return false;
  const primary = primaryGM(game);
  return !!primary && primary.id === game.user.id;
}

/** Whether a user update can change journey authority, sync or the Primary GM list. */
export function userChangeMatters(changes) {
  return !!changes && ["active", "role", "viewedScene", "name"].some((k) => k in changes);
}

export function primaryGMChoices(game = globalThis.game) {
  return { "": "Automatic: first connected GM in the user list", ...Object.fromEntries(Array.from(game?.users ?? []).filter((u) => u.isGM).map((u) => [u.id, u.name])) };
}
