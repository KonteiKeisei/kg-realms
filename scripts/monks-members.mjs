// Monk's TokenBar: the people, not the parties. The same file in KG Cities (city scenes) and KG
// Realms (any scene with a party token); nothing runs unless Monk's TokenBar is active.
//
// - Every party token on the scene shows as one entry per person in that party (its vehicles left
//   out), together, where the party's name sorts; the party's own entry goes. Each person is
//   listed once. Someone with a token of their own keeps that entry; someone Monk's lists without
//   a token ("include actor") joins their party. Players see only the people they may view
//   (Monk's view rule); whether the person's player is logged in does not matter.
// - Those entries are Monk's own kind for an actor without a token ("only-actor"), so its stats,
//   portraits and context menu work on them as they do for its own.
// - Click a person: their party's token is selected and the map pans to it (shift adds to the
//   selection without panning; ctrl targets it), as Monk's does for a token's entry.
// - Double-click opens the person's sheet; with Monk's "double-click requests a roll", it asks
//   their party (the members roll, see monks-bar.mjs).
// - The bar is rebuilt when a party's people change (a split, a merge, someone joining).

import { isKgParty, rollingMembers } from "./monks-bar.mjs";

const MTB = "monks-tokenbar";
const MEMBER = "kg-member";

const entryName = (e) => e.token?.name || e.actor?.name || "";

/**
 * Monk's bar entries with the scene's parties shown as their people. Pure.
 * - entries: Monk's entries. Any party entry among them is dropped (Monk's keeps one only for a
 *   party it would show itself, which is why the parties are passed in separately).
 * - parties: [{ tokenId, name, members: [actor] }], the party tokens on the scene.
 * - isParty(entry): the entry is a party's. show(actor): this user may see that person on the bar.
 * Someone with a token of their own keeps that entry; someone listed without a token (Monk's
 * "include actor") is moved into their party. Each person once. Each party's people go together,
 * where the party's name sorts among the rest, as Monk's sorts by name.
 */
export function expandParties(entries, { parties, isParty, show = () => true }) {
  const rest = entries.filter((e) => !isParty(e));
  const ownToken = new Set(rest.filter((e) => e.token && e.actor?.id).map((e) => e.actor.id));
  const seen = new Set();
  const groups = [];
  for (const party of [...parties].sort((a, b) => a.name.localeCompare(b.name))) {
    const rows = [];
    for (const actor of party.members) {
      if (!actor?.id || ownToken.has(actor.id) || seen.has(actor.id) || !show(actor)) continue;
      seen.add(actor.id);
      const kgParty = { tokenId: party.tokenId, name: party.name };
      const at = rest.findIndex((e) => !e.token && e.actor?.id === actor.id);
      if (at >= 0) {
        // Already on the bar without a token: it joins its party (Monk's has filled it in).
        const [own] = rest.splice(at, 1);
        own.cssClass = `${(own.cssClass ?? "").replace(/\bkg-\S+/g, "").trim()} ${MEMBER}`;
        rows.push(Object.assign(own, { kgParty }));
      } else {
        rows.push({
          id: actor.id, token: null, actor, name: actor.name, img: null, thumb: null,
          stats: {}, resource1: {}, resource2: {}, cssClass: `only-actor ${MEMBER}`, kgParty, kgNew: true
        });
      }
    }
    if (rows.length) {
      rows[0].cssClass += " kg-party-start";
      groups.push({ name: party.name, rows });
    }
  }
  const out = [...rest];
  for (const g of groups) {
    let at = out.findIndex((e) => !e.kgParty && entryName(e).localeCompare(g.name) > 0);
    if (at < 0) at = out.length;
    out.splice(at, 0, ...g.rows);
  }
  return out;
}

/**
 * Shared by KG Cities and KG Realms (the same file in both). isScene(scene): this module wants its
 * parties shown as people there. With both modules active, the bar is patched once and a scene
 * either module wants gets it.
 */
export function installMonksMembers({ isScene }) {
  const shared = (globalThis.__kgMonksMembers ??= { scenes: [], installed: false });
  shared.scenes.push(isScene);
  if (shared.installed) return;
  shared.installed = true;

  const active = () => !!game.modules.get(MTB)?.active;
  const onCity = () => !!canvas?.scene && shared.scenes.some((f) => { try { return !!f(canvas.scene); } catch { return false; } });
  const mtbSetting = (key) => { try { return game.settings.get(MTB, key); } catch { return undefined; } };
  const bar = () => game.MonksTokenBar?.TokenBar?.() ?? null;

  /** The party tokens on the scene this user can see, with their people. */
  const scenesParties = (scene) => scene.tokens
    .filter((t) => isKgParty(t.actor) && (game.user.isGM || !t.hidden))
    .map((t) => ({ tokenId: t.id, name: t.actor.name, members: rollingMembers(t.actor) }));
  const isParty = (entry) => isKgParty(entry?.actor);
  // This user may view the person (Monk's view rule). No "player online" rule: the party token is
  // on the scene, so its people are there whether or not their player is logged in or has the
  // character assigned (Monk's own online rule never passes for a party token).
  const show = (actor) => game.user.isGM || actor.isOwner
    || actor.testUserPermission(game.user, mtbSetting("minimum-ownership") || "LIMITED");

  let logged = null; // the scene last reported in the console
  /** The bar's parties become their people, in place. True when it worked. */
  async function expandBar(app) {
    if (!active() || !onCity() || !Array.isArray(app.entries)) return false;
    try {
      const parties = scenesParties(canvas.scene);
      const entries = expandParties(app.entries, { parties, isParty, show });
      // The new entries get their stats and pictures as Monk's own do.
      for (const entry of entries) {
        if (!entry.kgNew) continue;
        delete entry.kgNew;
        try { await app.updateEntry?.(entry, false); }
        catch (err) { console.warn("KG parties | Monk's TokenBar: stats for", entry.name, err); }
      }
      app.entries = entries;
      if (logged !== canvas.scene.id) {
        logged = canvas.scene.id;
        console.info(`KG parties | Monk's TokenBar: ${parties.length} parties on this scene, ${entries.filter((e) => e.kgParty).length} people listed`);
      }
      return true;
    } catch (err) {
      console.error("KG parties | Monk's TokenBar: listing party people failed", err);
      return false;
    }
  }

  /** Monk's bar class, wrapped once: on a wanted scene its parties become their people. (An older
   * KG Cities copy marked its own wrap __kgCitiesMembers, for city scenes only: wrap over it.) */
  function patch(app) {
    const proto = Object.getPrototypeOf(app);
    if (proto.__kgMonksMembers || typeof proto.getCurrentTokens !== "function") return false;
    const original = proto.getCurrentTokens;
    proto.getCurrentTokens = async function (...args) {
      const result = await original.apply(this, args);
      await expandBar(this);
      return result;
    };
    proto.__kgMonksMembers = true;
    return true;
  }

  /** The party token of a person's entry on the bar, on this scene. */
  const partyToken = (app, actorId) => {
    const entry = app.entries?.find((e) => e.kgParty && e.actor?.id === actorId);
    return entry ? canvas.tokens?.get(entry.kgParty.tokenId) ?? null : null;
  };

  function onClick(app, event) {
    if (event.altKey) return; // Monk's own alt-click (movement) is for tokens
    const li = event.currentTarget, token = partyToken(app, li.dataset.actorId);
    if (!token) return;
    const actor = game.actors.get(li.dataset.actorId);
    if (!game.user.isGM && !actor?.testUserPermission(game.user, "OBSERVER")) return;
    if (event.ctrlKey || event.metaKey) {
      token.setTarget(!game.user.targets.has(token), { user: game.user, releaseOthers: false, groupSelection: false });
      return;
    }
    if (event.shiftKey) {
      if (token.controlled) token.release(); else token.control({ releaseOthers: false });
      return;
    }
    token.control({ releaseOthers: true });
    if (!token.document.getFlag(MTB, "nopanning")) canvas.animatePan({ x: token.center.x, y: token.center.y });
  }

  function onDoubleClick(app, event) {
    // Monk's "request a roll" reads a token these entries don't have: ask the party instead.
    const asks = mtbSetting("dblclick-action") === "request" && (game.user.isGM || mtbSetting("allow-roll"));
    if (!asks) return; // Monk's opens the person's sheet
    event.stopImmediatePropagation();
    event.preventDefault();
    const token = partyToken(app, event.currentTarget.dataset.actorId);
    if (token) game.MonksTokenBar?.requestRoll?.([token]);
  }

  Hooks.on("renderTokenBar", (app, element) => {
    if (!active()) return;
    if (patch(app)) { app.refresh?.(); return; } // redraw with the people in
    if (!onCity()) return;
    // A party entry is still on the bar (drawn before the wrap took hold, or by another copy's
    // wrap): list its people now and draw again. Once per bar state, so a failure cannot loop.
    if (app.entries?.some(isParty)) {
      if (app.__kgRetried === app.entries) return;
      app.__kgRetried = app.entries;
      void expandBar(app).then((ok) => { if (ok) app.render?.(); });
      return;
    }
    const root = element instanceof HTMLElement ? element : element?.[0] ?? app?.element;
    for (const li of root?.querySelectorAll?.(`li.token.${MEMBER}[data-actor-id]`) ?? []) {
      if (li.dataset.kgBound) continue;
      li.dataset.kgBound = "1";
      const entry = app.entries?.find((e) => e.kgParty && e.actor?.id === li.dataset.actorId);
      if (entry) li.dataset.tooltip = `${entry.name}, in ${entry.kgParty.name}`;
      li.addEventListener("click", (e) => onClick(app, e));
      li.addEventListener("dblclick", (e) => onDoubleClick(app, e), { capture: true });
    }
  });

  // A party's people changed (a split, a merge, someone added): Monk's doesn't redraw for that.
  Hooks.on("updateActor", (actor, changes) => {
    if (!active() || actor.type !== "group" || !onCity()) return;
    const u = foundry.utils;
    if (u.hasProperty(changes, "system.members") || u.hasProperty(changes, "flags.kg-cities.party")
      || u.hasProperty(changes, "flags.kg-realms.party") || "name" in changes) bar()?.refresh?.();
  });
}
