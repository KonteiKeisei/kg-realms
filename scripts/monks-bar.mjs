// Monk's TokenBar (module "monks-tokenbar"): KG parties on the token bar.
// The same file ships in KG Cities and KG Realms. When both are active, only the first one to load
// installs it.
//
// - A token of a KG party (a dnd5e group actor carrying flags.kg-cities.party or
//   flags.kg-realms.party) is put on the bar as one entry. This uses Monk's own include flag on the
//   token, so nothing in Monk's is patched. The primary GM sets the flag.
// - That entry's picture shows the people inside the party, and its tooltip names them.
// - Monk's 13.02 expands a dnd5e party into its member records, not the member actors, when a roll
//   is requested for the party token, so those rows have no id. When the request window opens, those
//   rows are replaced by each member's token on the scene, or the member's actor when there is none
//   (people only, each once). Monk's own "add token" button fails on actor rows (its own include-actor
//   rows too), so add tokens before requesting for a party with no member tokens on the scene.
//
// Nothing here runs unless Monk's TokenBar is active.

const MTB = "monks-tokenbar";
const GUARD = "__kgMonksPartyBar";

/** A party's KG record, from either module. */
export const partyMeta = (a) => a?.flags?.["kg-cities"]?.party ?? a?.flags?.["kg-realms"]?.party ?? null;

// Extra party rules, shared by every copy of this file: KG Realms counts any group actor as a party
// (its record is only written on a split), KG Cities needs the record.
const partyRules = (globalThis.__kgPartyRules ??= []);
/** Count actors passing rule(actor) as parties too. */
export const addPartyRule = (rule) => { if (!partyRules.includes(rule)) partyRules.push(rule); };

/** A live KG party: a dnd5e group actor with a KG party record (or passing a module's rule) that
 * is not retired. */
export const isKgParty = (a) => a?.type === "group" && !partyMeta(a)?.retired
  && (!!partyMeta(a) || partyRules.some((rule) => { try { return !!rule(a); } catch { return false; } }));

const isVehicle = (a) => a?.type === "vehicle" || !!a?.flags?.["kg-cities"]?.vehicle?.vehicle;

/** A group's member actors, each once, groups left out. dnd5e stores rows of { actor }. */
export function memberActors(actor) {
  const rows = actor?.system?.members;
  const list = Array.isArray(rows) ? rows : rows ? Array.from(rows) : [];
  return [...new Map(list.map((row) => {
    let a = row?.actor ?? row;
    if (typeof a === "string") a = game.actors?.get(a.replace(/^Actor\./, ""));
    return a?.id && a.type !== "group" ? [a.id, a] : null;
  }).filter(Boolean)).values()];
}

/** The members who roll: people, not the party's vehicles. */
export const rollingMembers = (actor) => memberActors(actor).filter((a) => !isVehicle(a));

const isPrimaryGM = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;

/* ---- the party picture ------------------------------------------------------------------------ */

const PIC = 200, GAP = 4;
const pictures = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Cells for n pictures in a square: 1 whole, 2 side by side, 3 one tall and two stacked, 4 a 2 by 2. */
function cells(n) {
  const w = PIC, h = PIC, g = GAP, hw = (w - g) / 2, hh = (h - g) / 2;
  if (n <= 1) return [[0, 0, w, h]];
  if (n === 2) return [[0, 0, hw, h], [hw + g, 0, hw, h]];
  if (n === 3) return [[0, 0, hw, h], [hw + g, 0, hw, hh], [hw + g, hh + g, hw, hh]];
  return [[0, 0, hw, hh], [hw + g, 0, hw, hh], [0, hh + g, hw, hh], [hw + g, hh + g, hw, hh]];
}

/** Up to four members' portraits in one square picture, cropped to the top. Null if none can be drawn. */
export function partyPicture(actor) {
  const all = memberActors(actor), people = all.filter((a) => !isVehicle(a));
  const srcs = (people.length ? people : all).map((a) => a.img).filter(Boolean).slice(0, 4);
  if (!srcs.length) return Promise.resolve(null);
  const key = srcs.join("|");
  if (!pictures.has(key)) pictures.set(key, (async () => {
    const imgs = await Promise.all(srcs.map((s) => loadImage(s).catch(() => null)));
    const el = document.createElement("canvas");
    el.width = PIC; el.height = PIC;
    const ctx = el.getContext("2d");
    cells(imgs.length).forEach(([x, y, w, h], i) => {
      const img = imgs[i];
      if (!img) return;
      const k = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / k, sh = h / k;
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, 0, sw, sh, x, y, w, h);
    });
    try { return el.toDataURL("image/webp", 0.85); } catch { return null; } // a picture from elsewhere taints it
  })());
  return pictures.get(key);
}

/* ---- install ---------------------------------------------------------------------------------- */

export function installMonksPartyBar() {
  if (globalThis[GUARD]) return;
  globalThis[GUARD] = true;
  const active = () => !!game.modules.get(MTB)?.active;

  /** The primary GM puts every KG party token on a scene onto the bar. */
  async function includeParties(scene) {
    if (!active() || !isPrimaryGM() || !scene) return;
    const updates = scene.tokens
      .filter((t) => isKgParty(t.actor) && t.getFlag(MTB, "include") !== "include")
      .map((t) => ({ _id: t.id, [`flags.${MTB}.include`]: "include" }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates).catch((err) =>
      console.warn("KG | could not put parties on Monk's TokenBar:", err));
  }

  Hooks.once("ready", () => {
    if (!active() || !isPrimaryGM()) return;
    for (const scene of game.scenes) void includeParties(scene);
  });
  Hooks.on("canvasReady", () => void includeParties(canvas.scene));
  Hooks.on("createToken", (doc) => { if (isKgParty(doc.actor)) void includeParties(doc.parent); });
  Hooks.on("updateActor", (actor, changes) => {
    const u = foundry.utils;
    if (actor.type !== "group" || !(u.hasProperty(changes, "flags.kg-cities.party") || u.hasProperty(changes, "flags.kg-realms.party"))) return;
    for (const token of actor.getActiveTokens(false, true)) void includeParties(token.parent);
  });

  // The party entry shows who is inside it.
  Hooks.on("renderTokenBar", (app, element) => {
    if (!active()) return;
    const root = element instanceof HTMLElement ? element : element?.[0] ?? app?.element;
    for (const li of root?.querySelectorAll?.("li.token[data-actor-id]") ?? []) {
      const actor = game.actors.get(li.dataset.actorId);
      if (!isKgParty(actor)) continue;
      const names = memberActors(actor).filter((a) => !isVehicle(a)).map((a) => a.name);
      if (names.length) li.dataset.tooltip = `${actor.name}: ${names.join(", ")}`;
      li.classList.add("kg-party");
      partyPicture(actor).then((url) => {
        const img = li.querySelector("img.token-icon");
        if (url && img && img.src !== url) img.src = url;
      }).catch(() => {});
    }
  });

  // A request for a party token: Monk's lists member records; roll the members' actors instead.
  Hooks.on("renderSavingThrowApp", (app) => {
    if (!active() || !Array.isArray(app?.entries)) return;
    let changed = false;
    const seen = new Set(), fixed = [];
    for (const entry of app.entries) {
      const t = entry?.token;
      const isRow = t && !(t instanceof Actor) && !(t instanceof foundry.canvas.placeables.Token) && t.actor instanceof Actor;
      if (isRow) {
        changed = true;
        if (isVehicle(t.actor) || t.actor.type === "group") continue;
        // The member's own token when one is on this scene (Monk's "add token" button needs a
        // token's actor), else the actor itself, as Monk's does for actors without tokens.
        entry.token = globalThis.canvas?.tokens?.placeables?.find((p) => p.actor?.id === t.actor.id) ?? t.actor;
      }
      const actorId = entry?.token?.actor?.id ?? entry?.token?.id;
      if (actorId && seen.has(actorId)) { changed = true; continue; }
      if (actorId) seen.add(actorId);
      fixed.push(entry);
    }
    if (!changed) return;
    app.entries = fixed;
    app.render();
  });
}
