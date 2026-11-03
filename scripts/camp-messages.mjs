// User document updates provide the sender identity. Module socket payloads do not.
const ID = "kg-realms", KEY = "campMessage";
let sending = Promise.resolve();
export function sendCampMessage(message) {
  const user = game.user;
  // A string replaces the previous request atomically instead of merging stale fields into it.
  const body = JSON.stringify({ ...message, nonce: foundry.utils.randomID() });
  const work = sending.catch(() => {}).then(() => user.setFlag(ID, KEY, body));
  sending = work;
  return work.catch(error => { ui.notifications.warn(`KG Realms: the camp request could not be sent: ${error.message}`); });
}
export function receiveCampMessage(user, changes, author, receive) {
  const body = changes.flags?.[ID]?.[KEY] ?? changes[`flags.${ID}.${KEY}`];
  if (author !== user.id || !user.active || typeof body !== "string" || body.length > 1000000) return;
  let message;
  try { message = JSON.parse(body); } catch { return; }
  if (!message || typeof message !== "object" || !["watch", "practice", "banner"].includes(message.type)) return;
  return receive(message, user.id);
}

/** Reject malformed watch edits and references outside this party. */
export function validWatchChanges(changes, ids) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return false;
  const fields = Object.entries(changes);
  if (!fields.length) return false;
  return fields.every(([key, value]) => {
    if (key === "order") return Array.isArray(value) && value.length <= ids.size && new Set(value).size === value.length && value.every(id => ids.has(id));
    if (!["hours", "sleep", "join"].includes(key) || !value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.entries(value).every(([id, v]) => ids.has(id) && (key === "hours" ? Number.isFinite(v) && v >= 0 && v <= 8 : key === "sleep" ? ["full", "trance", "none"].includes(v) : typeof v === "boolean"));
  });
}
