// Flash Token Bar 5e (module "flash-rolls-5e"): the parties on its bar, as Monk's TokenBar shows
// them (monks-members.mjs). The same file in KG Cities (city scenes) and KG Realms (any scene with a
// party token); nothing runs unless Flash Token Bar 5e is active. On a wanted scene:
//  - the bar opens on its Group tab (once per scene visit; the GM can still pick another tab);
//  - on every scene (0.98.2 / 0.17.8), the parties are always on the Group tab, wherever their token
//    is; any other group (an encounter) only when it, or one of its members, has a token on the scene;
//  - every party is listed there, open, its people under it, with one
//    picture of them (its vehicles left out); its people are its members, ready for a roll request;
//  - a plain click on a party, or on one of its people, picks just that (shift adds, as Flash does),
//    selects the party's token and pans to it, as Monk's TokenBar does.
// Why: Flash's "show only PCs with a token" (on by default) drops a group when none of its MEMBERS
// has a token, and party members ride inside the party token. While Flash builds its Group tab on a
// wanted scene, that one setting reads false inside Flash's processGroupActor only (0.98.2 / 0.17.8:
// it read false for every caller meanwhile, so Flash's settings window could save it off, and then
// every group and actor in the world showed on every scene); the rows are then trimmed to groups
// really on the scene.
// Checked against Flash Token Bar 5e 1.30.9. Restored from KG Cities 0.17.2 (KG Cities 0.17.6, KG Realms 0.98.0).

import { isKgParty, partyMeta, partyPicture } from "./monks-bar.mjs";

const FLASH = "flash-rolls-5e";
const MENU_ID = "flash-rolls-menu";
const TOKEN_ONLY = "show-only-pcs-with-token";
const REFRESH = "flash-token-bar.refreshMenu";
/** Changes come in bursts (a split creates a group, its token, and renames): one refresh after. */
const SETTLE_MS = 300;

/**
 * Shared by KG Cities and KG Realms (the same file in both). isScene(scene): this module wants its
 * parties on Flash's bar there. With both modules active, Flash is patched once.
 */
export function installFlashParties({ isScene }) {
  const shared = (globalThis.__kgFlashParties ??= { scenes: [], installed: false });
  shared.scenes.push(isScene);
  if (shared.installed) return;
  shared.installed = true;

  const active = () => !!game.modules.get(FLASH)?.active;
  const wanted = () => !!canvas?.scene && shared.scenes.some((f) => { try { return !!f(canvas.scene); } catch { return false; } });
  let forcing = 0;
  let groupTabFor = null; // the scene the Group tab was last switched on for
  let timer = null;
  const refresh = () => {
    if (!active()) return;
    clearTimeout(timer);
    timer = setTimeout(() => Hooks.callAll(REFRESH), SETTLE_MS);
  };

  // "Show only PCs with a token" reads false while Flash builds its Group tab on a wanted scene.
  const get = game.settings.get;
  game.settings.get = function (namespace, key, ...rest) {
    if (forcing > 0 && namespace === FLASH && key === TOKEN_ONLY && /processGroupActor/.test(new Error().stack ?? "")) return false;
    return get.call(this, namespace, key, ...rest);
  };

  /** A party token of this group on the scene the user can see. */
  const partyToken = (actorId) => canvas?.tokens?.placeables.find((t) => t.actor?.id === actorId && isKgParty(t.actor) && (game.user.isGM || !t.document.hidden)) ?? null;
  /** The party token a person rides in, on this scene: the group row they are listed under. */
  const partyOf = (el) => partyToken(el?.closest?.(".actor-group, [data-group-id]")?.dataset?.actorId ?? el?.closest?.("[data-group-id]")?.dataset?.groupId);
  const goTo = (token) => { if (!token) return; token.control({ releaseOthers: true }); canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 }); };

  /** Groups shown: a party always (retired ones never); any other group when it, or a member, has a token on this scene. */
  function onScene(row, scene) {
    const actor = game.actors.get(row.id);
    if (!actor) return false;
    if (isKgParty(actor)) return true;
    if (actor.type === "group" && partyMeta(actor)?.retired) return false;
    if (scene.tokens.some((t) => t.actorId === row.id && (game.user.isGM || !t.hidden))) return true;
    return (row.members ?? []).some((m) => m.tokenId);
  }

  function patch(app) {
    const proto = Object.getPrototypeOf(app);
    if (proto.__kgFlashParties) return false;
    const original = proto._prepareContext;
    proto._prepareContext = async function (options) {
      if (!canvas?.scene) return original.call(this, options);
      const scene = canvas.scene;
      // The Group tab opens by itself on a scene with a party token; elsewhere the tab stays as left.
      if (groupTabFor !== scene.id && wanted() && scene.tokens.some((t) => isKgParty(t.actor))) { groupTabFor = scene.id; this.currentTab = "group"; }
      if (this.currentTab !== "group") return original.call(this, options);
      // Parties start open, their people listed under them; the GM's own folding is kept as Flash keeps it.
      this.groupExpansionStates ??= {};
      for (const a of game.actors) if (a.type === "group" && this.groupExpansionStates[a.id] === undefined) this.groupExpansionStates[a.id] = isKgParty(a);
      forcing++;
      let context;
      try { context = await original.call(this, options); } finally { forcing--; }
      if (Array.isArray(context?.groups)) {
        context.groups = context.groups.filter((row) => onScene(row, scene));
        // One picture of everyone in the party (Flash stacks 2 to 4 in a column too narrow to see them).
        for (const row of context.groups) {
          const actor = game.actors.get(row.id);
          if (!isKgParty(actor)) continue;
          const url = await partyPicture(actor).catch(() => null);
          if (url) row.memberImages = [url];
        }
      }
      return context;
    };
    // A plain click picks just that party (or member); shift-click adds to what is picked, as Flash
    // does. A party's click also selects its token and pans to it, as on Monk's TokenBar.
    const click = proto._onActorClick;
    if (click) proto._onActorClick = function (event) {
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.target?.closest?.(".actor-select")) {
        const el = event.currentTarget, keep = new Set();
        if (el?.classList?.contains("actor-group")) {
          const row = (this._lastPreparedContext?.groups ?? []).find((g) => g.id === el.dataset.actorId);
          for (const m of row?.members ?? []) keep.add(m.uniqueId);
          goTo(partyToken(el.dataset.actorId));
        } else if (el?.dataset?.id) {
          keep.add(el.dataset.id);
          // One of a party's people: their party's token.
          goTo(partyOf(el) ?? this._lastPreparedContext?.groups?.map((g) => ((g.members ?? []).some((m) => m.uniqueId === el.dataset.id || m.id === el.dataset.actorId) ? partyToken(g.id) : null)).find(Boolean));
        }
        for (const id of [...(this.selectedActors ?? [])]) {
          if (keep.has(id)) continue;
          const isActor = game.actors.has(id), actorId = isActor ? id : canvas.scene?.tokens.get(id)?.actorId;
          if (actorId) this._toggleActorSelection(id, actorId, isActor ? null : id);
          else this.selectedActors.delete(id);
        }
        this._updateGroupSelectionUI?.();
      }
      return click.call(this, event);
    };
    proto.__kgFlashParties = true;
    return true;
  }

  // The menu exists once Flash renders it; patch its class then, and redraw with the patch.
  Hooks.on("renderApplicationV2", (app) => {
    if (app?.id !== MENU_ID || !active()) return;
    if (patch(app)) app.render();
  });

  Hooks.on("canvasReady", () => {
    if (!active()) return;
    if (!wanted()) groupTabFor = null;
    refresh();
  });
  for (const hook of ["createToken", "deleteToken", "createActor", "deleteActor"]) Hooks.on(hook, () => refresh());
  Hooks.on("updateActor", (actor, changes) => {
    if (actor.type !== "group") return;
    const u = foundry.utils;
    if (u.hasProperty(changes, "system.members") || u.hasProperty(changes, "flags.kg-cities.party") || u.hasProperty(changes, "flags.kg-realms.party") || "name" in changes || "img" in changes) refresh();
  });
}
