import {RealmDialog} from "./ui-theme.mjs";
import { renderPanel } from "./panel-render.mjs";
import { spotName, spotTitle, spotRealms } from "./map-layers.mjs";
import {groupMembers,sceneParties,partyLabel} from './party-groups.mjs';
import { travelRules, ruleTooltip, ruleContent, ruleParagraphs } from "./travel-rules.mjs";
// The travel panel on a realm map, for everyone. The GM plans the route (stops on the map, pace,
// rules, stays, encounters along the way) and starts the journey; from then the party travels
// with the game clock: however time moves on (this panel, Calendaria, anything), the party's
// tokens stand where the party is by then. After a day's travel it stops for the GM: make camp
// or push on. It stops at each encounter until the GM carries on.
// The journey is kept on the scene (flags.kg-realms.journey), so every client draws the same.
import { RIDE_DEALS, ridePrice, roadGapMiles, roadReachMiles, buildGraph, itinerary, perceptionAgainst, terrainLookup, encounterHours, replayTrip, pointAtHour, routeSheet, elapsedAt, campHours, projectCamps, PACES, METHODS, speedFactor } from "./travel.mjs";
import { randomCampEscape } from "./camp-resolution.mjs";
import { regionalPointAtDistance } from "./regional-maps.mjs";
import {journeyEncounterKey} from './encounter-map.mjs';
import { buildSea, planSea, VESSELS, automaticPort, terrainHarbours, portForStop, portVoyage, riverAt, riverLabel, boatOptions, voyageParts, pathCrossing, WAY_LABELS } from "./waterways.mjs";
import { assetStrip, assetDrag, openPinned, openDoc } from "./place-card.mjs";
import { CampPanel, showDC } from "./ui-camp.mjs";
import { onCanvas, RightClick } from "./canvas-input.mjs";
import { applyHeight, heightGrip } from "./float-panel.mjs";
import { editBar, uiBounds } from "./ui-editbar.mjs";
import { selectPartyTokens } from "./party-token.mjs";
import {chooseSettlementGate, enterSettlement, settlementArrivalMode} from './settlement-entry.mjs';
import { lonLatToSource, sourceToLonLat, SOURCE_MAP } from "./source-map.mjs";
import { latLonToScene, sceneToLatLon } from "./geo.mjs";
import { isPrimaryGM, primaryGM } from "./authority.mjs";
import { journeyKey, progressKey, snapshotNeeded } from "./journey-state.mjs";
import { captureScroll, restoreScroll } from "./panel-scroll.mjs";
import { shellHead, foldCaret } from "./ui-shell.mjs";
import { writeJourney } from "./journey-write.mjs";
import { keepTravelled } from "./route-pin.mjs";
import { walkingHistory, retimeWalking, baseTravelHour } from "./walking-timing.mjs";
import { biomeLookup, biomeFlag, syncPartyBiome, freezeBiomeTravel, biomeTypes } from "./biomes.mjs";
import { partyFavoredBiomes } from "./favored-terrain.mjs";
import { isRiverHazard, isHazard } from "./river-hazards.mjs";

const MODULE_ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
/**
 * How encumbered a character is, else "": the system's own encumbrance conditions (dnd5e, with its
 * encumbrance rule on), else its carried weight against the thresholds.
 */
function burdenOf(a) {
  const st = a?.statuses;
  if (st?.has?.("exceedingCarryingCapacity")) return "over carrying capacity";
  if (st?.has?.("heavilyEncumbered")) return "heavily encumbered";
  if (st?.has?.("encumbered")) return "encumbered";
  // dnd5e works out the variant thresholds (5 and 10 times Strength) whatever rule the world uses:
  // they count only under Variant Encumbrance; with the rule off, only carrying capacity counts.
  const e = a?.system?.attributes?.encumbrance, v = Number(e?.value), t = e?.thresholds ?? {};
  if (!Number.isFinite(v)) return "";
  let rule = "normal";
  try { rule = game.settings.get("dnd5e", "encumbrance") ?? "normal"; } catch {}
  if (rule === "none") return "";
  if (Number.isFinite(t.maximum) && v > t.maximum) return "over carrying capacity";
  if (rule !== "variant") return "";
  if (Number.isFinite(t.heavilyEncumbered) && v > t.heavilyEncumbered) return "heavily encumbered";
  if (Number.isFinite(t.encumbered) && v > t.encumbered) return "encumbered";
  if (!t.encumbered && Number.isFinite(Number(e?.max)) && Number(e.max) > 0 && v > Number(e.max)) return "over carrying capacity";
  return "";
}
const KM = 1.609344;
const mi = (m) => (m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString());
const both = (m) => `${mi(m)} mi (${mi(m * KM)} km)`;
const hrs = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h * 10) / 10} h`);
// method: how the party travels (METHODS), methodMph for a custom speed or a flying mount. Per leg
// (by waypoint, the leg into it): legModes null | "direct" | "sea" | "road" (a ship turned down),
// legMethods (a method for that leg), legVessels (a VESSELS key, or "actor:<uuid>" for a vehicle
// actor), legFares (gp a head, haggled). fares: the default prices, ship sp and coach cp a mile.
const DEFAULT = { name: "", waypoints: [], stays: [], legModes: [], legMethods: [], legVessels: [], legFares: [], legWays: [], encounters: [], pace: "normal", hours: 8, rest: 16, show: "route", start: null, trip: null, now: null,
  method: "foot", methodMph: 8, fares: { ship: 1, coach: 3, wagon: 2 }, shipSkip: [] };
const SNAP_PX = 14, HIT_PX = 10, ENCOUNTER_MI = 2;
/** The parts of a journey that route edits change (and Ctrl+Z puts back). */
/** While the party is on the move, the least real time between sending its tokens' positions (ms). */
const TOKEN_MOVE_MS = 2000;
/** Whether the party's tokens are sent now: at once unless it is simply on the move, then every TOKEN_MOVE_MS. */
export function tokenMoveDue({ force = false, status, lastStatus, since }) {
  return force || status !== "moving" || lastStatus !== status || since >= TOKEN_MOVE_MS;
}
const ROUTE_KEYS = ["waypoints", "stays", "legModes", "legMethods", "legVessels", "legFares", "legWays", "encounters", "name"];
/** Lists kept per waypoint, which move with it. */
const LEG_KEYS = ["stays", "legModes", "legMethods", "legVessels", "legFares", "legWays"];
/** How far from a port a boat may be boarded: the harbour (miles). */
const HARBOUR_MI = 18;
const rule = ruleTooltip;
const gp = (v) => (v >= 10 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString());

/** Seconds to move when the GM chooses one more hour, capped by the next encounter or arrival. */
export function pushedHourAdvance(now, dayEnd, next) {
  if (!Number.isFinite(now) || !Number.isFinite(dayEnd)) return 0;
  const stop = Math.min(Math.max(now, dayEnd) + 3600, Number.isFinite(next?.since) ? next.since : Infinity);
  return Math.max(0, Math.ceil(stop - now));
}

export class TravelHud {
  /** getLayer, getPlaces, getRoutes, getEncounters (with sheet `at`, radius in px), getTerrain (async). */
  constructor(options) {
    Object.assign(this, options);
    this.toSource = (lon, lat) => lonLatToSource(lon, lat, this.sourceMap);
    this.toLonLat = (x, y) => sourceToLonLat(x, y, this.sourceMap);
    this.el = null;
    this.mode = null; // "route" | "encounter" while editing on the map
    this.result = null;
    this.plan = null;
    this.appliedWalking = "null";
    this.asked = new Set();
    this.camp = new CampPanel(this);
    this.right = new RightClick();
    this.handlers = { pointerdown: (e) => this.#down(e), pointermove: (e) => this.#move(e), pointerup: (e) => this.#up(e), contextmenu: (e) => { if (this.mode) e.preventDefault(); } };
  }

  get sourceMap() { return this.getSourceMap?.() ?? SOURCE_MAP; }

  get editing() { return !!this.mode; }
  /** 2014 (difficult terrain halves the distance) or 2024 (terrain caps the pace): a world setting. */
  get rules() { return this.#get("travelRules") ?? "2014"; }

  /** The travel rules as short text for tips and the Rules tab, in the edition the world uses. */
  ruleText(rules = this.rules) {
    const out = travelRules(rules), lore = this.getWorldRules?.()?.seasons;
    // The world's own sea lore (KG Realms: Faerûn's Sword Coast winds), else the general rule.
    if (Array.isArray(lore) && lore.length) out.seasons = ruleParagraphs(lore.filter((r) => Array.isArray(r) && r.length === 2).map(([a, b]) => [String(a), String(b)]));
    return out;
  }

  /** Leave route or encounter editing (the map editor is opening). */
  stopEditing() { if (!this.mode) return; this.#setMode(null); this.render(); }

  /** Hide the panel while the map editor is open, and show it again after. */
  suspend(on) {
    this.suspended = !!on;
    if (on) this.#setMode(null);
    this.render();
    if (!on && this.refreshPending) return this.refresh();
  }
  get scene() { return this.getScene?.() ?? canvas.scene; }
  // The GM's route edits in progress (0.96.7) sit on top of the saved journey on this client only.
  get state() { const scene = this.scene; return { ...DEFAULT, ...(scene?.getFlag(MODULE_ID, "journey") ?? {}), ...(this.draft && this.draftScene === scene ? this.draft : {}), ...(scene?.partyId?{partyId:scene.partyId}:{}) }; }
  get clock() { return game.time.worldTime; }
  /** The GM who moves the tokens and asks the questions (one, when several are on). */
  get leader() { return isPrimaryGM(); }

  /** Every stop, starting from the party: where it stands now, or where it set off from. */
  stops() {
    const s = this.state;
    const start = (s.trip && s.start) ? s.start : this.#partyStop();
    return start ? [start, ...s.waypoints] : s.waypoints;
  }
  /** The GM's open tab: the route, or the encounters along it (per user, this browser). */
  get tab() { try { const t = localStorage.getItem("kgr-travel-tab"); return ["enc", "rules", "camp"].includes(t) ? t : "route"; } catch { return "route"; } }
  set tab(v) { try { localStorage.setItem("kgr-travel-tab", v); } catch { /* storage off */ } }
  get collapsed() { try { return localStorage.getItem("kgr-travel-collapsed") === "1"; } catch { return false; } }
  set collapsed(v) { try { localStorage.setItem("kgr-travel-collapsed", v ? "1" : "0"); } catch { /* storage off */ } }

  async save(changes, { undoable = true, scene = this.scene, expectedTrip = journeyKey(this.state), expectedCamp = undefined } = {}) {
    if (!this.leader || !scene) return;
    const routeOnly = Object.keys(changes).every((k) => ROUTE_KEYS.includes(k));
    // Anything else (setting off, ending the journey) goes out with the route as edited so far.
    if (this.draft && !routeOnly) await this.#publishDraft();
    const state = scene === this.scene ? this.state : { ...DEFAULT, ...(scene.getFlag(MODULE_ID, "journey") ?? {}) };
    if (expectedTrip !== undefined && journeyKey(state) !== expectedTrip) return;
    // During a journey, the way already travelled can't change (0.96.7).
    if (scene === this.scene && state.trip && !("trip" in changes) && !("start" in changes) && ["waypoints", ...LEG_KEYS].some((k) => k in changes)) {
      const where = this.#whereNow();
      if (where) {
        const kept = keepTravelled(state, changes, where);
        if (kept.refused) { ui.notifications.warn("KG Realms: the party has already travelled that part of the route. Only the way ahead can change."); this.draw?.(); this.render?.(); return; }
        if (kept.pinned) {
          changes = kept.changes;
          if (this.selected != null && this.selected >= where.cur) this.selected += 1;
          if (this.drag && this.drag.i >= where.cur) this.drag.i += 1;
          ui.notifications.info("KG Realms: a stop now marks where the party is, so the way already travelled stays as it was.");
        }
      }
    }
    // Route edits (stops, legs, stays, the journey's encounters) can be stepped back with Ctrl+Z.
    if (undoable && ROUTE_KEYS.some((k) => k in changes)) {
      const before = Object.fromEntries(ROUTE_KEYS.map((k) => [k, foundry.utils.deepClone(this.state[k] ?? null)]));
      if (ROUTE_KEYS.some((k) => k in changes && JSON.stringify(changes[k]) !== JSON.stringify(before[k]))) {
        (this.history ??= []).push(before);
        if (this.history.length > 40) this.history.shift();
      }
    }
    // While the GM edits the route, the changes stay on this client (worked out and drawn here); the
    // players get the finished route once, when editing ends, instead of every click (0.96.7).
    if (this.mode && routeOnly && scene === this.scene) {
      this.draft = { ...(this.draft ?? {}), ...changes };
      this.draftScene = scene; this.draftTrip = expectedTrip;
      return this.refresh();
    }
    await writeJourney(scene, () => changes, { trip: expectedTrip, campId: expectedCamp });
  }

  /** Send the route edits held on this client to the scene, for everyone. */
  async #publishDraft() {
    const draft = this.draft, scene = this.draftScene, trip = this.draftTrip;
    this.draft = this.draftScene = this.draftTrip = null;
    if (!draft || !scene) return;
    try { await writeJourney(scene, () => draft, { trip }); }
    catch (err) { console.error("kg-realms | saving the route:", err); ui.notifications.error(`KG Realms: the route edits were not saved: ${err.message}`); }
  }

  /**
   * Where the party is on the route now, for a route edit during a journey: on leg `cur` (which ends at
   * waypoint cur), partway along it (`mid`, with a stop to put there) or at its start. Null before
   * setting off, after arriving, or with no route worked out.
   */
  #whereNow() {
    const p = this.progress(), ends = this.result?.legEnds ?? [];
    if (!p || p.status === "arrived" || !ends.length) return null;
    const hour = p.hour ?? 0, cur = ends.findIndex((h) => h > hour + 1e-6);
    if (cur < 0) return null;
    const mid = hour > (cur ? ends[cur - 1] : 0) + 1e-6, here = mid ? this.#at(hour) : null;
    if (!here) return { cur, mid: false, pin: null };
    const [lon, lat] = this.toLonLat(here[0], here[1]);
    return { cur, mid: true, pin: { lon, lat, name: this.placeName(lon, lat), stop: true, pinned: true } };
  }

  /** Step the route back one edit. */
  async undo() {
    const prev = this.history?.pop();
    if (!prev) return ui.notifications.info("KG Realms: nothing to undo on this route.");
    this.selected = null;
    await this.save(Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v ?? (k === "name" ? "" : [])])), { undoable: false });
  }

  mount() {
    this.unmount();
    this.history = [];
    this.result=this.plan=this.resultTrip=this.sheet=this.trackMiles=null;this.routeFeet=null;
    this.asked.clear();this.openedEncounterCards?.clear();
    this.suspended = false;
    this.offRoute = null;
    this.el = document.createElement("section");
    this.el.className = "kgr-ui kgr-travel";
    document.body.append(this.el);
    this.el.addEventListener("click", (e) => this.#click(e));
    this.el.addEventListener("change", (e) => this.#change(e));
    // A stop's handle: drag it up or down the list, or press the arrow keys on it.
    this.el.addEventListener("pointerdown", (e) => this.#gripDown(e));
    this.el.addEventListener("pointermove", (e) => this.#gripMove(e));
    this.el.addEventListener("pointerup", (e) => this.#gripUp(e));
    this.el.addEventListener("pointercancel", () => this.#gripEnd());
    this.el.addEventListener("keydown", (e) => {
      const row = e.target.closest?.(".tr-row[data-act]");
      if (row && !e.target.closest(".stop-grip") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return row.click(); }
      const grip = e.target.closest?.(".stop-grip");
      if (!grip || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || !this.leader) return;
      e.preventDefault(); e.stopPropagation();
      this.#moveStop(Number(grip.dataset.grip), e.key === "ArrowUp" ? -1 : 1);
    });
    // The Route section folded or open: kept across redraws.
    this.el.addEventListener("toggle", (e) => { if (e.target.dataset?.sec === "route") this.routeShut = !e.target.open; }, true);
    // A ship for a sea leg: a vehicle actor dropped on the leg's ship line (water vehicles only).
    this.el.addEventListener("dragover", (e) => {
      if (this.camp.dragOver(e)) return;
      if (game.user.isGM && e.target.closest?.(".ship-drop, [data-camp-drop]")) { e.preventDefault(); e.target.closest(".ship-drop")?.classList.add("over"); }
    });
    this.el.addEventListener("dragleave", (e) => e.target.closest?.(".ship-drop")?.classList.remove("over"));
    // The watch order (rows dragged, a scene dropped on the camp), else a ship on a sea leg.
    this.el.addEventListener("drop", async (e) => { if (await this.camp.drop(e)) return; this.#drop(e); });
    this.el.addEventListener("dragstart", (e) => { if (!this.camp.dragStart(e)) assetDrag(e); });
    this.el.addEventListener("focusout", () => setTimeout(() => { if (this.held && this.el && !this.el.contains(document.activeElement)) this.render(); }, 0));
    this.el.addEventListener("pointerdown", (e) => this.#grab(e));
    this.onResize = () => this.#place();
    window.addEventListener("resize", this.onResize);
    this.refresh();
  }

  /* ------------------------------------------------------------------ position */
  // As the ship HUD does it: x and y as client settings (-1 until first placed), a lock in the
  // header, dragging by the header only while unlocked, kept on screen, and a panel on the right
  // half of the screen grows and shrinks from its right edge.

  #get(k) { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } }
  #set(k, v) { return game.settings.set(MODULE_ID, k, v).catch(() => {}); }
  get locked() { return !!this.#get("travelHudLocked"); }

  #clamp(x, y) {
    const w = this.el?.offsetWidth || 400, h = this.el?.offsetHeight || 200;
    return [Math.max(0, Math.min(x, window.innerWidth - w)), Math.max(0, Math.min(y, window.innerHeight - Math.min(h + 8, window.innerHeight)))];
  }

  /** First placement: hard against the left of the sidebar, under the scene navigation. */
  #defaultPos() {
    const w = this.el?.offsetWidth || 400;
    const b = uiBounds();
    return [Math.max(b.left + 12, Math.round(b.right - w - 14)), Math.max(12, Math.round(b.top + 12))];
  }

  #pinnedRight() {
    const x = parseInt(this.el?.style.left) || this.#get("travelHudX");
    return x + (this.el?.offsetWidth || 400) / 2 >= window.innerWidth / 2;
  }

  #place() {
    if (!this.el) return;
    let sx = this.#get("travelHudX"), sy = this.#get("travelHudY");
    if (!(sx >= 0) || !(sy >= 0)) { [sx, sy] = this.#defaultPos(); this.#set("travelHudX", sx); this.#set("travelHudY", sy); }
    const [x, y] = this.#clamp(sx, sy);
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
    this.el.classList.toggle("locked", this.locked);
    // Its height, as set with the grip on its bottom edge (put back after each redraw); minimised, it fits.
    heightGrip(this.el, (h) => this.#set("travelHudH", h));
    const height = this.collapsed ? 0 : this.#get("travelHudH") ?? 0;
    applyHeight(this.el, height);
    if (!this.collapsed && !height) this.el.style.maxHeight = `${Math.max(72, uiBounds().bottom - y - 12)}px`;
  }

  /** Re-render without the panel jumping: on the right half, keep the right edge where it was. */
  #keepEdge(fn) {
    if (!this.el) return fn();
    const holdRight = this.#pinnedRight(), rightEdge = (parseInt(this.el.style.left) || 0) + this.el.offsetWidth;
    fn();
    if (holdRight && this.el) {
      const [x] = this.#clamp(rightEdge - this.el.offsetWidth, parseInt(this.el.style.top) || 0);
      this.el.style.left = `${x}px`;
      this.#set("travelHudX", x);
    }
  }

  #grab(e) {
    if (e.button !== 0 || this.locked || !e.target.closest("header") || e.target.closest("button, [data-act], input, select")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = parseInt(this.el.style.left) || 0, oy = parseInt(this.el.style.top) || 0;
    const move = (ev) => { const [x, y] = this.#clamp(ox + ev.clientX - sx, oy + ev.clientY - sy); this.el.style.left = `${x}px`; this.el.style.top = `${y}px`; };
    const up = async () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      this.el.classList.remove("dragging");
      await this.#set("travelHudX", parseInt(this.el.style.left) || 0);
      await this.#set("travelHudY", parseInt(this.el.style.top) || 0);
    };
    this.el.classList.add("dragging");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  unmount() {
    this.lifecycleEpoch = (this.lifecycleEpoch ?? 0) + 1;
    this.panelHtml = null;
    this.refreshGeneration = (this.refreshGeneration ?? 0) + 1;
    clearTimeout(this.tokenMoveTimer); this.tokenMoveTimer = null;
    this.#setMode(null);
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    this.el?.remove();
    this.el = null;
    this.camp.renderScene(null);
    this.getLayer()?.setJourney(null);
  }

  toggle() { this.#keepEdge(() => { this.collapsed = !this.collapsed; if (this.collapsed) this.#setMode(null); this.render(); }); }

  /* ------------------------------------------------------------------ plan */

  /** Work the route out again. A failure is said in the panel (and the console), not lost. */
  async refresh(opts = {}) {
    try {
      const out = await this.#refreshNow(opts);
      if (this.routeError) { this.routeError = null; this.render?.(); }
      return out;
    } catch (err) {
      console.error("kg-realms | working out the route", err);
      this.routeError = err?.message ?? String(err);
      this.result = this.sheet = null;
      this.render?.();
    }
  }

  async #refreshNow({force = false} = {}) {
    if (!this.el && !this.headless) return;
    // A saved editor point must paint before expensive route/sea rebuilding. Keep the last plan
    // until editing ends, or a clock tick/explicit journey request needs a current projection.
    if (this.suspended && !force) {
      this.refreshPending = true;
      this.refreshGeneration = (this.refreshGeneration ?? 0) + 1;
      return;
    }
    this.refreshPending = false;
    const generation = this.refreshGeneration = (this.refreshGeneration ?? 0) + 1;
    const scene = this.scene, element = this.el;
    const s = this.state;
    let currentFeet, walking = null;
    // The last route stays in place while the new one is worked out (the travel log reads it meanwhile).
    let result = null;
    if (this.stops().length > 1) {
      const routes = this.getRoutes();
      if (this.graphFor !== routes) {
        // Roads are named from the map's road and trail labels.
        const labels = this.getPlaces().filter((p) => ['Road', 'Trail'].includes(p.class)).map((p) => ({ name: p.name, at: this.toSource(p.lon, p.lat) }));
        this.graph = this.baseGraph = buildGraph(routes.features, this.toSource, labels);
        this.graphFor = routes;
      }
      this.graph=this.baseGraph??this.graph;
      const grid = await this.getTerrain();
      if (generation !== this.refreshGeneration || this.scene !== scene || this.el !== element) return;
      this.prepareBiomes(grid);
      // Freeze travel defaults at departure. Editing a forest during play must not retime
      // miles already covered. Position flags and new camp DCs use the live configuration.
      const previousBiomes=s.trip?.biomeTravel;
      const travelBiomes=s.trip?(previousBiomes?.version?previousBiomes:freezeBiomeTravel(previousBiomes??{},true)):freezeBiomeTravel(this.getBiomes?.()??{});
      const travelKey=JSON.stringify(travelBiomes);
      if(this.travelBiomeGrid!==grid||this.travelBiomeKey!==travelKey){this.travelBiomeGrid=grid;this.travelBiomeKey=travelKey;this.travelBiomeQuery=biomeLookup(travelBiomes,terrainLookup(grid),this.toSource,{legacyPriority:!!travelBiomes.legacyPriority});}
      let terrainAt = this.travelBiomeQuery.terrain;
      const regionalKey=JSON.stringify([this.stops(),s.waypoints,s.legModes,s.legMethods,s.legVessels,s.legWays,s.method,s.methodMph,s.coachMph,s.pace,s.hours,this.rules]);
      const frozen=s.trip?.regionalPlan;
      const network=(!s.trip||frozen)&&!(frozen?.key===regionalKey)?await this.getRegionalNetwork?.():null;
      if(generation!==this.refreshGeneration||this.scene!==scene||this.el!==element)return;
      this.regionalNetwork=network;
      if(network){this.graph=network.graph;terrainAt=network.terrainAt(terrainAt);}
      this.regionalTerrain=terrainAt;
      this.regionalKey=regionalKey;
      if(s.trip&&!previousBiomes?.version&&this.leader&&this.canSync?.()!==false){
        await writeJourney(scene,fresh=>fresh.trip&&JSON.stringify(fresh.trip.biomeTravel??null)===JSON.stringify(previousBiomes??null)?{"trip.biomeTravel":structuredClone(travelBiomes)}:null,{trip:journeyKey(s),valid:()=>this.scene===scene&&generation===this.refreshGeneration&&this.canSync?.()!==false});
        if(generation!==this.refreshGeneration||this.scene!==scene||this.el!==element)return;
      }
      this.#buildSea(grid);
      // routeFeet: the speed this route was worked out with (a change to it works it out again).
      currentFeet = this.speed().feet;
      walking = s.trip ? walkingHistory(s.trip.walking, this.resultTrip === journeyKey(s) ? this.routeFeet : s.now?.walkFeet ?? currentFeet) : { baseFeet: currentFeet, favored: this.favoredTerrains(), changes: [] };
      this.routeFeet = currentFeet;
      this.routeFavored = JSON.stringify(this.favoredTerrains());
      const pts = this.stops().map((w) => this.toSource(w.lon, w.lat)), baseMph = (walking?.baseFeet ?? currentFeet) / 10;
      const legs = pts.slice(1).map((_, i) => ({
        method: { key: s.legMethods?.[i] ?? s.method, baseMph, mph: s.methodMph, roadMph: s.coachMph },
        sea: s.legModes?.[i] === "sea" ? { vessel: { ...this.vessel(s.legVessels?.[i]), way: s.legWays?.[i] ?? null } } : null,
        // No way overland (an island, a port cut off by water): by boat instead, if water joins them.
        seaFallback: s.legModes?.[i] === "direct" ? null : { vessel: this.vessel(s.legVessels?.[i]) }
      }));
      this.landArgs = { terrainAt, baseMph };
      result = frozen?.key===regionalKey ? structuredClone(frozen.result) : itinerary(this.graph, pts, { segments:network?.segments, stays: s.stays, legModes: s.legModes ?? [], legs, seaPlan: (a, b, v) => this.seaPlan(a, b, v), mode: "roads", rules: this.rules, pace: s.pace, hoursPerDay: s.hours, terrainAt, milesPerPixel: this.sourceMap.milesPerPixel, baseMph });
      this.regionalSnapshot=result&&(network||frozen)?{key:regionalKey,result:JSON.parse(JSON.stringify(result))}:null;
      // A route edit deliberately replans the remaining itinerary; map edits alone use the snapshot.
      // (Not while route edits are held on this client: it is written with the finished route.)
      if(s.trip&&frozen&&frozen.key!==regionalKey&&this.leader&&result&&!this.draft){
        await writeJourney(scene,()=>({"trip.regionalPlan":this.regionalSnapshot??{key:regionalKey,result:JSON.parse(JSON.stringify(result))}}),{trip:journeyKey(s),valid:()=>this.scene===scene&&generation===this.refreshGeneration});
        if(generation!==this.refreshGeneration||this.scene!==scene)return;
      }
      // No way found: which leg, and what lies under its ends (the panel says, and the console).
      this.noRouteWhy = null;
      if (!result) {
        const sts = this.stops(), names = sts.map((w, i) => w.name ?? (i ? `stop ${i}` : "the start"));
        const under = (q) => { const T = terrainAt(q[0], q[1]); return T?.water ? "water" : T?.name ?? "land"; };
        let leg = -1;
        for (let i = 0; i + 1 < pts.length && leg < 0; i++) if (!itinerary(this.graph, [pts[i], pts[i + 1]], { legModes: [s.legModes?.[i] ?? null], legs: [legs[i]], seaPlan: (a, b, v) => this.seaPlan(a, b, v), mode: "roads", rules: this.rules, pace: s.pace, hoursPerDay: s.hours, terrainAt, milesPerPixel: this.sourceMap.milesPerPixel, baseMph })) leg = i;
        const i = Math.max(0, leg);
        const roadOnly = METHODS[legs[i]?.method?.key]?.roadsOnly && legs[i]?.method?.key;
        const gap = (q) => roadGapMiles(this.graph, q, this.sourceMap.milesPerPixel), far = (q) => gap(q) > roadReachMiles(this.sourceMap.milesPerPixel);
        const offRoad = roadOnly ? (far(pts[i]) ? { name: names[i], miles: gap(pts[i]) } : far(pts[i + 1]) ? { name: names[i + 1], miles: gap(pts[i + 1]) } : null) : null;
        this.noRouteWhy = { leg: i, from: names[i], to: names[i + 1], fromOn: under(pts[i]), toOn: under(pts[i + 1]), roads: this.graph?.nodes?.size ?? 0, roadOnly, offRoad };
        console.warn("kg-realms | no route", { ...this.noRouteWhy, stops: sts.map((w, k) => ({ name: names[k], lon: w.lon, lat: w.lat, sheet: pts[k], on: under(pts[k]) })), legModes: s.legModes, legMethods: s.legMethods });
      }
    } else {
      const grid = await this.getTerrain();
      if (generation !== this.refreshGeneration || this.scene !== scene || this.el !== element) return;
      this.#buildSea(grid);
      this.prepareBiomes(grid);
    }
    if (result && walking) {
      const raw = result;
      result = retimeWalking(raw, walking, { terrainAt: this.regionalTerrain??this.travelBiomeQuery.terrain });
      const lastFeet = walking.changes.at(-1)?.feet ?? walking.baseFeet;
      const lastFavored = walking.changes.findLast(c => Array.isArray(c.favored))?.favored ?? walking.favored ?? [], favored = this.favoredTerrains();
      const favoredChanged = JSON.stringify(lastFavored) !== JSON.stringify(favored);
      if (s.trip && this.leader && this.canSync?.() !== false && (!s.trip.walking || lastFeet !== currentFeet || favoredChanged)) {
        this.result = result; this.#projectProgress();
        const p = this.progress();
        const updated = { ...walking, changes: [...walking.changes] };
        if ((lastFeet !== currentFeet || favoredChanged) && p && p.status !== "arrived") {
          const hour = baseTravelHour(result.track, p.hour);
          updated.changes = updated.changes.filter((c) => c.hour < hour - 1e-9);
          updated.changes.push({ hour, feet: currentFeet, at: this.clock, ...(favoredChanged || walking.favored || walking.changes.some(c => c.favored) ? { favored } : {}) });
        }
        const trip = journeyKey(s), previous = JSON.stringify(s.trip.walking ?? null);
        if (JSON.stringify(updated) !== previous) await writeJourney(scene, (fresh) => JSON.stringify(fresh.trip?.walking ?? null) === previous ? { "trip.walking": updated } : null,
          { trip, valid: () => this.scene === scene && generation === this.refreshGeneration && this.canSync?.() !== false });
        if (generation !== this.refreshGeneration || this.scene !== scene || this.el !== element) return;
        result = retimeWalking(raw, this.state.trip?.walking ?? walking, { terrainAt: this.regionalTerrain??this.travelBiomeQuery.terrain });
      }
    }
    const r = this.result = result;
    // Stops with no way between them: the panel says so, and still lists the stops.
    this.noRoute = this.stops().length > 1 && !result;
    this.resultTrip = journeyKey(this.state);
    this.appliedWalking = JSON.stringify(this.state.trip?.walking ?? null);
    this.appliedBiomeTravel = JSON.stringify(this.state.trip?.biomeTravel ?? null);
    this.plan = null;
    if (r) {
      // Miles done at each point of the track, for "x mi of y".
      let m = 0;
      this.trackMiles = r.track.map((p, i) => Number.isFinite(p.miles)?(m=p.miles):(m += i ? Math.hypot(p.at[0] - r.track[i - 1].at[0], p.at[1] - r.track[i - 1].at[1]) * this.sourceMap.milesPerPixel : 0));
      const scale = r.miles / (m || 1);
      this.trackMiles = this.trackMiles.map((v) => v * scale);
      this.#projectProgress();
      // The route sheet: places passed, roads joined and left, and stops kept (places or stays).
      const sts = this.stops();
      const places = this.getPlaces().filter((p) => !p.hidden && p.kind !== "natural" && p.kind !== "territory" && p.kind !== "domain" && !(p.unnamed && !p.edited) && !["Road", "Trail", "Area", "Region", "Macroregion", "Sea"].includes(p.class))
        .map((p) => ({ name: p.name, at: this.toSource(p.lon, p.lat), settlement: p.kind === "settlement" }));
      const nums = this.#numbers();
      this.sheet = routeSheet(r, { stops: sts.map((w, i) => ({ name: w.name ?? "Stop", keep: i === 0 || nums[i - 1] != null })), places, milesPerPixel: this.sourceMap.milesPerPixel });
      this.shipHints = this.headless || this.regionalSnapshot ? [] : this.#shipHints();
      this.legChoices = this.headless || this.regionalSnapshot || !game.user.isGM ? [] : this.#legChoices();
      this.riverOffers = this.headless || this.regionalSnapshot || !game.user.isGM ? [] : this.#riverOffers();
    } else { this.sheet = null; this.shipHints = []; this.legChoices = []; this.riverOffers = []; }
    // Port availability is independent of whether sailing would beat the road. Cache it with
    // the route sheet, so clock updates and camp redraws do not rescan the world's ports.
    const nodes = this.sheet?.nodes ?? this.stops().slice(0, 1).map((w) => ({ at: this.toSource(w.lon, w.lat) }));
    this.seaNodes = new Map(nodes.flatMap((n, i) => {
      const [lon, lat] = this.toLonLat(...n.at), p = this.portAt({ lon, lat, name: n.name });
      if (p) return [[i, `Port of ${p.name}: sea travel available`]];
      const river = n.stop != null ? riverAt({ lon, lat }, this.getWaterways?.(), this.toSource, this.sourceMap.milesPerPixel) : null;
      if (!river) return [];
      const label = riverLabel(river);
      return [[i, `On ${label}: boat travel available`]];
    }));
    // The GM is told when a change to the route leaves encounters placed for it behind.
    if (game.user.isGM) {
      const met = new Set((this.plan?.encounters ?? []).map((e) => e.id));
      const off = (s.encounters ?? []).filter((e) => !met.has(e.id));
      const was = this.offRoute;
      this.offRoute = new Set(off.map((e) => e.id));
      const fresh = was && this.plan ? off.filter((e) => !was.has(e.id)) : [];
      if (fresh.length) ui.notifications.warn(`KG Realms: the route no longer passes ${fresh.map((e) => e.name).join(", ")}. They are listed under Encounters.`);
    }
    await this.tick({ force: true });
    if (!this.leader && this.state.trip) this.onSyncNeeded?.(scene.id);
  }

  /** Camp state changes reuse the route, graph, terrain and route sheet. */
  refreshProgress() {
    if (!this.result || this.appliedWalking !== JSON.stringify(this.state.trip?.walking ?? null) || (this.appliedBiomeTravel ?? "null") !== JSON.stringify(this.state.trip?.biomeTravel ?? null)) return this.refresh();
    this.#projectProgress();
    return this.tick();
  }

  prepareBiomes(grid) {
    const config=this.getBiomes?.()??{},key=JSON.stringify(config);
    if(this.biomeGrid!==grid||this.biomeKey!==key||!this.biomeQuery){this.biomeGrid=grid;this.biomeKey=key;this.biomeQuery=biomeLookup(config,terrainLookup(grid),this.toSource);}
  }
  currentBiome() {
    if(!this.biomeQuery)return null;
    const p=this.progress(),stop=!p?this.#partyStop():null,at=p?this.#at(p.hour):stop?this.toSource(stop.lon,stop.lat):null;
    const sample=p?this.result?.track.findLast(q=>q.hour<=p.hour):null;
    return at?biomeFlag(sample?.regionTitle ? sample.terrain?.biome : this.biomeQuery(...at),{world:sample?.worldId??this.getWorld?.(),scene:this.scene?.id}):null;
  }
  async syncBiome() {
    if(!this.getBiomes||!this.leader||this.canSync?.()===false)return;
    const scene=this.scene,epoch=this.lifecycleEpoch;
    const grid=await this.getTerrain();if(scene!==this.scene||epoch!==this.lifecycleEpoch)return;
    this.prepareBiomes(grid);
    // Without a journey, a real party token is the position source. No token means unknown,
    // rather than clearing flags belonging to a journey on another scene.
    if(!this.progress()&&!this.#partyStop())return;
    const valid=()=>this.scene===scene&&this.lifecycleEpoch===epoch&&this.leader&&this.canSync?.()!==false;
    this.biomeSync=(this.biomeSync??Promise.resolve()).catch(()=>{}).then(()=>valid()?syncPartyBiome(this.members(),this.currentBiome(),valid):undefined);
    // Its weather follows (biome-weather.mjs): null at sea.
    const p=this.progress(),stop=!p?this.#partyStop():null,here=p?this.#at(p.hour):stop?this.toSource(stop.lon,stop.lat):null;
    if(here)this.onBiome?.(scene,this.biomeQuery(...here),here,this.biomeQuery);
    return this.biomeSync.catch(e=>console.warn("kg-realms | biome flags:",e));
  }

  #projectProgress() {
    const r = this.result, s = this.state;
    if (!r) return;
    const encounters = game.user.isGM ? encounterHours(r.track, [...[...this.getEncounters(), ...this.#ownEncounters()].map((e) => ({ ...e, radius: e.reach })), ...(this.getTowns?.() ?? [])]).filter((e) => e.kind !== "town" || e.hour > .25) : [];
    this.plan = { hours: r.hours, encounters, sail: r.sail, stays: r.legEnds.map((hour, i) => ({ hour, seconds: (s.stays[i] ?? 0) * 86400 })) };
    const opts = { hoursPerDay: s.hours, rest: s.rest };
    this.camps = s.trip ? projectCamps(s.trip, { ...this.plan, encounters: this.#withCamps(encounters, campHours(this.plan, r.hours, opts)) }, opts) : campHours(this.plan, r.hours, opts);
    this.plan.encounters = this.#withCamps(encounters, this.camps);
  }

  /* ------------------------------------------------------------------ water */

  /** The sea for routing: the map's water and the GM's waterways, rebuilt when either changes. */
  #buildSea(grid) {
    const ww = this.getWaterways?.() ?? {}, key = JSON.stringify(ww);
    if (this.seaKey === key && this.seaGrid === grid) return;
    this.seaKey = key; this.seaGrid = grid; this.seaCache = new Map();
    // Ports, for keeping their harbours open: the GM's, and settlements by the map's own water (the
    // sea is not built yet to ask). Within 6 miles, as autoPort().
    const ports = terrainHarbours(grid, grid ? this.getPlaces() : [], this.toSource, this.sourceMap.milesPerPixel);
    this.sea = grid ? buildSea(grid, Object.entries(ww).map(([id, w]) => ({ id, ...w, pts: (w.pts ?? []).map((c) => this.toSource(c[0], c[1])) })), { milesPerPixel: this.sourceMap.milesPerPixel, ports }) : null;
  }

  /** The way by water between two sheet points for a vessel, in this season (remembered). */
  seaPlan(from, to, vessel) {
    const season = this.getSeason?.() ?? "summer", way = vessel.way ?? "best", key = `${from.map(Math.round)}|${to.map(Math.round)}|${vessel.mph}|${season}|${way}`;
    this.seaCache ??= new Map();
    if (!this.seaCache.has(key)) {
      // Between boarding points a boat always goes. Anywhere else needs the water to be there.
      const mpp = this.sourceMap.milesPerPixel, opts = { mph: vessel.mph, season, reach: HARBOUR_MI / mpp, milesPerPixel: mpp };
      const river = way === "river" ? planSea(this.sea, from, to, { ...opts, ways: "river" }) : null;
      this.seaCache.set(key, river ?? (this.boatAtPoint(from) && this.boatAtPoint(to) ? portVoyage(this.sea, from, to, { ...opts, ways: way === "sea" ? "sea" : "all" }) : planSea(this.sea, from, to, opts)));
    }
    return this.seaCache.get(key);
  }

  /** A leg's vessel: a VESSELS key, or a vehicle actor dropped on the leg ("actor:<uuid>"). */
  vessel(key) {
    if (key?.startsWith("actor:")) {
      const a = fromUuidSync(key.slice(6), { strict: false });
      const v = a ? TravelHud.vehicleVessel(a) : null;
      if (v) return v;
    }
    return { key: VESSELS[key] ? key : "sailing", ...(VESSELS[key] ?? VESSELS.sailing) };
  }

  /**
   * A dnd5e vehicle actor as a vessel, or null when it is not a water vehicle. Its speed comes
   * from its travel pace (mph) when the sheet has one, else from the vehicle table by its name,
   * else 2 mph. Crewed (it sails round the clock) unless it is a rowed boat.
   */
  static vehicleVessel(actor) {
    if (actor?.type !== "vehicle") return null;
    const sys = actor.system ?? {}, type = sys.vehicleType ?? sys.details?.type;
    if (type && type !== "water") return null;
    const preset = Object.entries(VESSELS).find(([, v]) => new RegExp(`\\b${v.label.split(" ")[0]}`, "i").test(actor.name));
    const travel = sys.attributes?.travel, mv = sys.attributes?.movement ?? {};
    const paced = Number(travel?.paces?.water ?? travel?.speeds?.water ?? travel?.water);
    const units = String(travel?.units ?? mv.units ?? "").toLowerCase();
    const mph = paced > 0 ? (units === "kph" || units === "km" ? paced / 1.609 : paced)
      : ["mi", "mph"].includes(units) && Number(mv.swim) > 0 ? Number(mv.swim) : preset?.[1].mph ?? 2;
    return { key: `actor:${actor.uuid}`, label: actor.name, mph, crewed: preset ? preset[1].crewed : !/row|keel|canoe|raft/i.test(actor.name), actor: actor.uuid, img: actor.img };
  }

  /** A settlement by the water (the sea, a lake, or a river the GM drew): a port unless the GM says not. */
  autoPort(p) {
    return automaticPort(p, this.sea, this.toSource, this.sourceMap.milesPerPixel);
  }
  /**
   * A GM's port setting, else the automatic rule. The automatic answer scans the sea, so it is
   * remembered per place until the sea is rebuilt or the place moves.
   */
  isPort(p) {
    if (!p) return false;
    if (p.port != null) return !!p.port;
    if (this.portSea !== this.sea) { this.portSea = this.sea; this.portCache = new Map(); }
    const key = `${p.id}|${p.lon}|${p.lat}|${p.kind}`;
    let auto = this.portCache.get(key);
    if (auto === undefined) this.portCache.set(key, auto = !!this.autoPort(p));
    return auto;
  }

  /** The port at a stop (waterways.mjs portForStop), or null. Hidden ones only for the GM. */
  portAt(w) {
    return portForStop(w, this.getPlaces().filter((p) => (!p.hidden || game.user?.isGM) && this.isPort(p)), this.toSource, this.sourceMap.milesPerPixel);
  }
  /** Where a boat can be boarded at a stop, in words: "port of Arine", "the river Oban", or "". */
  boatAt(w) {
    const p = this.portAt(w);
    if (p) return `port of ${p.name}`;
    const river = riverAt(w, this.getWaterways?.(), this.toSource, this.sourceMap.milesPerPixel);
    return river ? riverLabel(river) : "";
  }
  /** The same at a sheet point: a stop standing there counts by its name. */
  boatAtPoint(q) {
    const [lon, lat] = this.toLonLat(q[0], q[1]);
    const stop = this.stops().find((w) => { const at = this.toSource(w.lon, w.lat); return Math.hypot(at[0] - q[0], at[1] - q[1]) < 1; });
    return this.boatAt(stop ?? { lon, lat });
  }
  /** Whether leg i (from stop i to stop i + 1) can go by boat: a port or a drawn river at both ends. */
  legByWater(i) { return !!this.legPorts(i); }
  /** "port of Arine to the river Oban" for leg i, or "" when a boat cannot do it. */
  legPorts(i) {
    const sts = this.stops(), a = this.boatAt(sts[i]), b = this.boatAt(sts[i + 1]);
    return a && b ? `${a} to ${b}` : "";
  }

  /** The world's prices against the book's (the Prices setting): ×1 to ×10, or ÷2 to ÷10. */
  get priceScale() {
    const m = /^([xd])(\d+)$/.exec(this.#get("priceScale") ?? "x1");
    return !m ? 1 : m[1] === "x" ? Number(m[2]) : 1 / Number(m[2]);
  }

  /** A leg's fare a head (gp): the GM's haggled price, else the default for the way it goes. null: free. */
  fareOf(i) {
    const s = this.state, leg = this.result?.legs[i];
    if (!leg) return null;
    const own = s.legFares?.[i];
    const f = { ...DEFAULT.fares, ...(s.fares ?? {}) }, k = this.priceScale;
    const method = s.legMethods?.[i] ?? s.method;
    const ride = !leg.sea && (method === "wagon" || method === "coach") ? ridePrice(leg.miles, method, s, k) : null;
    const def = leg.sea ? leg.miles * f.ship / 10 * k : ride?.gp ?? null;
    if (def == null) return null;
    return { gp: own ?? def, def, haggled: own != null && Math.abs(own - def) > 0.05, paid: !!ride?.paid };
  }

  /**
   * What each leg between boarding points can choose: land (its miles and hours) and each way by
   * water. A leg no boat can do has null.
   */
  #legChoices() {
    const s = this.state, r = this.result, mpp = this.sourceMap.milesPerPixel, season = this.getSeason?.() ?? "summer";
    const sts = this.stops();
    return r.legs.map((L, i) => {
      if (!this.legByWater(i)) return null;
      const v = this.vessel(s.legVessels?.[i]), key = `opts|${L.from.map(Math.round)}|${L.to.map(Math.round)}|${v.mph}|${season}`;
      this.seaCache ??= new Map();
      if (!this.seaCache.has(key)) this.seaCache.set(key, boatOptions(this.sea, L.from, L.to, { mph: v.mph, season, reach: HARBOUR_MI / mpp, milesPerPixel: mpp, ports: !!(this.portAt(sts[i]) && this.portAt(sts[i + 1])) }));
      return { land: L.sea ? this.#landLeg(i, L) : L, boat: this.seaCache.get(key), vessel: v };
    });
  }

  /** Leg i by land, whichever way it is going now (remembered), or null if there is no way. */
  #landLeg(i, L) {
    const s = this.state, method = s.legMethods?.[i] ?? s.method;
    if (this.landFor !== this.graph) { this.landFor = this.graph; this.landCache = new Map(); }
    const key = `${L.from}|${L.to}|${method}|${s.pace}|${s.hours}|${this.rules}|${s.legModes?.[i] === "direct"}|${s.methodMph}|${s.coachMph}`;
    if (!this.landCache.has(key)) {
      let leg = null;
      try {
        const { terrainAt, baseMph } = this.landArgs ?? {};
        leg = itinerary(this.graph, [L.from, L.to], { legModes: [s.legModes?.[i] === "direct" ? "direct" : null], legs: [{ method: { key: method, baseMph, mph: s.methodMph, roadMph: s.coachMph } }], mode: "roads", rules: this.rules, pace: s.pace, hoursPerDay: s.hours, terrainAt, milesPerPixel: this.sourceMap.milesPerPixel, baseMph })?.legs[0] ?? null;
      } catch (err) { console.warn("kg-realms | land option:", err); }
      this.landCache.set(key, leg);
    }
    return this.landCache.get(key);
  }

  /** Which way by water a leg is taking: the GM's choice if it is on offer, else what its voyage uses. */
  #wayOf(i, L) {
    const chosen = this.state.legWays?.[i], list = this.legChoices?.[i]?.boat ?? [];
    if (chosen && list.some((o) => o.key === chosen)) return chosen;
    const kinds = new Set(voyageParts(L.plan, HARBOUR_MI).map((p) => p.kind));
    return kinds.size > 1 ? "both" : kinds.has("river") ? "river" : "sea";
  }

  /**
   * Where the road crosses a drawn river that reaches the next stop: a leg on land can leave the road
   * there and go down it, if that is sooner. [{ leg, river, at, landMiles, landHours, plan }].
   */
  #riverOffers() {
    const s = this.state, r = this.result, sts = this.stops(), mpp = this.sourceMap.milesPerPixel, now = this.progress()?.hour ?? -1, out = [];
    const boat = VESSELS.keelboat, season = this.getSeason?.() ?? "summer";
    r.legs.forEach((L, i) => {
      if (L.sea || L.start + L.hours <= now) return;
      const river = riverAt(sts[i + 1], this.getWaterways?.(), this.toSource, mpp);
      if (!river || s.shipSkip?.includes(`river|${i}|${river.name ?? ""}`)) return;
      const track = r.track.filter((q) => q.leg === i && q.hour >= now);
      const hit = pathCrossing(track.map((q) => q.at), river.pts.map((c) => this.toSource(c[0], c[1])));
      if (!hit) return;
      let landMiles = 0;
      for (let k = 1; k <= hit.index; k++) landMiles += Math.hypot(track[k].at[0] - track[k - 1].at[0], track[k].at[1] - track[k - 1].at[1]) * mpp;
      landMiles += Math.hypot(hit.at[0] - track[hit.index].at[0], hit.at[1] - track[hit.index].at[1]) * mpp;
      const plan = planSea(this.sea, hit.at, L.to, { mph: boat.mph, season, reach: HARBOUR_MI / mpp, ways: "river" });
      if (!plan) return;
      const landHours = track[hit.index].hour - L.start, leftHours = L.start + L.hours - track[hit.index].hour;
      // Sooner by boat (8 hours a day) than the rest of the road (the party's hours a day)?
      if (plan.hours / 8 >= leftHours / s.hours) return;
      out.push({ leg: i, river, at: hit.at, landMiles, landHours, plan });
    });
    return out;
  }

  /**
   * Where a ship would be quicker, as cards: one for each port the party boards at (a stop that is a
   * port, or the first port the road passes after a stop that is not), each with the ports it could
   * sail to. A stop with no stay set is optional: a ship sails on past it, calling there when it is
   * a port (the party can still choose to stop when it arrives) and skipping it when it is not. A
   * stop with a stay is not sailed past. Only voyages that beat the road (round the clock) by a
   * quarter, and at least six hours, are offered. The GM takes one, or keeps the road.
   */
  #shipHints() {
    const r = this.result, sh = this.sheet, s = this.state;
    if (!r || !sh || !this.sea || !game.user.isGM) return [];
    const mpp = this.sourceMap.milesPerPixel, now = this.progress()?.hour ?? -1;
    const ports = this.getPlaces().filter((p) => !p.hidden && this.isPort(p)).map((p) => ({ p, at: this.toSource(p.lon, p.lat) }));
    const near = (n) => { const [lon, lat] = this.toLonLat(n.at[0], n.at[1]), p = portForStop({ lon, lat, name: n.name }, ports.map((q) => q.p), this.toSource, mpp); return p ? ports.find((q) => q.p === p) : null; };
    const pts = sh.nodes.map((n, i) => ({ n, i, q: near(n) }));
    const anchors = pts.filter((x) => x.n.stop != null);
    const stayOf = (x) => (x.n.stop > 0 ? Number(s.stays?.[x.n.stop - 1]) || 0 : 0);
    const vessel = this.vessel("sailing"), opts = { hoursPerDay: s.hours, rest: s.rest };
    const f = { ...DEFAULT.fares, ...(s.fares ?? {}) };
    const mark = (x) => ({ ...x.q, hour: x.n.hour, stop: x.n.stop, node: x.i, name: x.n.name });
    const cards = [];
    for (let k = 0; k + 1 < anchors.length; k++) {
      const from = anchors[k], ax = from.q ? from : pts.slice(from.i + 1, anchors[k + 1].i).find((x) => x.q);
      if (!ax || ax.n.hour < now - 1e-6) continue;
      const a = mark(ax), options = [], calls = [], skips = [];
      const consider = (bx) => {
        if (!bx || bx.i <= ax.i || bx.q.p.id === a.p.id) return;
        const b = mark(bx);
        if (s.shipSkip?.includes(`${a.p.id}|${b.p.id}`)) return;
        if (r.legs.some((l) => l.sea && l.start < b.hour - 0.5 && l.start + l.hours > a.hour + 0.5)) return;
        // Port to port: calling at each port stop on the way.
        const seq = [a, ...calls, b];
        let hours = 0, miles = 0;
        for (let i = 1; i < seq.length; i++) {
          const leg = this.seaPlan(seq[i - 1].at, seq[i].at, vessel);
          if (!leg) return;
          hours += leg.hours; miles += leg.miles;
        }
        const land = elapsedAt(this.plan, b.hour, opts) - elapsedAt(this.plan, a.hour, opts);
        if (hours > land * 0.75 || land - hours < 6) return;
        options.push({ b, calls: [...calls], skips: [...skips], sea: { hours, miles }, land, fare: miles * f.ship / 10 * this.priceScale });
      };
      for (let j = k + 1; j < anchors.length; j++) {
        const to = anchors[j], prev = anchors[j - 1];
        consider(to.q ? to : pts.slice(Math.max(prev.i, ax.i) + 1, to.i).findLast((x) => x.q));
        // Sail on past it only when it is optional (no stay) and not the end.
        if (j === anchors.length - 1 || stayOf(to) > 0) break;
        if (to.q) calls.push(mark(to)); else skips.push({ name: to.n.name });
      }
      // A port an earlier card already sails to or calls at waits until that card is turned down.
      const covered = cards.some((c) => c.options.some((o) => o.b.p.id === a.p.id || o.calls.some((x) => x.p.id === a.p.id)));
      if (options.length && !covered) cards.push({ a, options });
    }
    return cards;
  }

  /**
   * Take a voyage from a card: the port boarded at and the port sailed to become stops, the ports
   * called at stay as stops, and every leg from boarding to landing goes by sea. Whatever lay between
   * (path points, optional stops that are not ports) is dropped.
   */
  async takeShip(card, opt) {
    const s = this.state, ends = this.result.legEnds;
    const vals = (k) => Object.fromEntries(LEG_KEYS.map((key) => [key, s[key]?.[k] ?? null]));
    const entries = s.waypoints.map((p, k) => ({ p, hour: ends[k], vals: vals(k) }));
    const add = (m) => {
      if (m.stop === 0) return null;
      if (m.stop != null) return entries[m.stop - 1];
      const next = entries.find((e) => e.hour >= m.hour - 1e-6);
      const e = { p: { lon: m.p.lon, lat: m.p.lat, name: m.p.name }, hour: m.hour, vals: { ...Object.fromEntries(LEG_KEYS.map((key) => [key, null])), stays: 0, legMethods: next?.vals.legMethods ?? null } };
      entries.push(e);
      return e;
    };
    const a = add(card.a), b = add(opt.b), calls = new Set(opt.calls.map((c) => entries[c.stop - 1]).filter(Boolean));
    if (!b) return;
    entries.sort((x, y) => x.hour - y.hour);
    const lo = a ? entries.indexOf(a) : -1, hi = entries.indexOf(b);
    const keep = entries.filter((e, k) => k <= lo || k >= hi || calls.has(e));
    for (const e of keep) {
      const k = entries.indexOf(e);
      if (k > lo && k <= hi) { e.vals.legModes = "sea"; e.vals.legVessels = e.vals.legVessels ?? "sailing"; e.vals.legFares = null; e.vals.legWays = null; }
    }
    this.selected = null;
    await this.save({ waypoints: keep.map((e) => e.p), ...Object.fromEntries(LEG_KEYS.map((key) => [key, keep.map((e) => e.vals[key])])) });
    ui.notifications.info(`KG Realms: by ship from ${card.a.p.name} to ${opt.b.p.name}${opt.calls.length ? `, calling at ${opt.calls.map((c) => c.p.name).join(", ")}` : ""}.`);
  }

  /**
   * The stops the list shows (a place, a stay, or the end) numbered 1, 2, 3 in order; the other
   * clicks only shape the path. Returns an array over the waypoints: a number, or null.
   */
  #numbers() {
    const s = this.state, w = s.waypoints;
    let n = 0;
    return w.map((p, i) => (i === w.length - 1 || p.stop || this.#onPlace(p) || (s.stays[i] ?? 0) > 0 ? ++n : null));
  }

  /** Whether a stop sits on a place (it was snapped to one). */
  #onPlace(w) { return this.getPlaces().some((q) => Math.abs(q.lon - w.lon) < 1e-9 && Math.abs(q.lat - w.lat) < 1e-9); }

  /** This journey's own encounters, placed along the route: sheet `at`, a small radius. */
  #ownEncounters() {
    return (this.state.encounters ?? []).map((e) => ({ ...e, at: this.toSource(e.lon, e.lat), reach: (e.radius ?? ENCOUNTER_MI) / this.sourceMap.milesPerPixel }));
  }

  /** Where the journey stands now: replayed on the GM's side, the GM's last word for players. */
  progress(now = this.clock, opts = {}) {
    const s = this.state;
    if (!s.trip) return null;
    if (!game.user.isGM) return s.now;
    if (!this.plan) return null;
    return replayTrip(s.trip, this.plan, now, { hoursPerDay: s.hours, ...(this.unfocused?{autoRest:s.rest,skipCamp:true}:{}), ...opts });
  }

  /** Redraw for the current time, and (GM) move the party there. */
  tick({ force = false } = {}) {
    if (this.refreshPending) return this.refresh({force: true});
    if (!this.headless) { this.draw(); this.render(); }
    else if(!this.unfocused)this.camp.followClock(this.progress());
    if (force) this.forceSnapshot = true;
    if (this.leader) return this.#sync().catch((err) => console.warn("kg-realms | journey sync:", err));
  }

  async advanceClock(seconds) {
    if (!this.leader || seconds <= 0) return;
    this.motionDuration = 8000;
    try { await game.time.advance(seconds); await this.tick({ force: true }); }
    finally { this.motionDuration = null; }
  }

  /** The day of the journey (1 on setting off) on which travel hour `hour` falls, by the plan's schedule. */
  #dayAt(hour) {
    const s = this.state;
    return Math.floor(elapsedAt(this.plan, hour, { hoursPerDay: s.hours, rest: s.rest }) / 24 + 1e-9) + 1;
  }
  #at(hour) {
    const escape = this.state.trip?.escape;
    if (escape && Math.abs(hour - escape.hour) < 1e-6 && this.progress()?.status === "halted") return escape.at;
    return this.result ? pointAtHour(this.result.track, hour) : null;
  }

  async planCampEscape(miles) {
    const from = this.#at(this.progress()?.hour ?? 0); if (!from) return null;
    const grid=await this.getTerrain();this.prepareBiomes(grid);const network=await this.getRegionalNetwork?.(),terrain=network?network.terrainAt(this.biomeQuery.terrain):this.biomeQuery.terrain;
    const valid = ([x, y]) => x >= 0 && y >= 0 && x <= this.sourceMap.width && y <= this.sourceMap.height && !terrain(x, y).water;
    const escape = randomCampEscape(from, miles, this.sourceMap.milesPerPixel, valid, Math.random, network?(bearing,distance)=>regionalPointAtDistance(from,bearing,distance,network.segments,this.sourceMap.milesPerPixel):null); if (!escape) return null;
    const mph = Math.max(.1, this.speed().feet / 10 * PACES[this.state.pace].mph / 3);
    let seconds = 0;
    for (let i = 0; i < 8; i++) {
      const x = from[0] + (escape.at[0] - from[0]) * (i + .5) / 8, y = from[1] + (escape.at[1] - from[1]) * (i + .5) / 8;
      const a=[from[0]+(escape.at[0]-from[0])*i/8,from[1]+(escape.at[1]-from[1])*i/8],b=[from[0]+(escape.at[0]-from[0])*(i+1)/8,from[1]+(escape.at[1]-from[1])*(i+1)/8];
      const distance=network?network.segments(a,b).reduce((n,s)=>n+s.miles,0):escape.distance/8;
      seconds += distance / (mph * speedFactor("offroad", terrain(x, y), { rules: this.rules, pace: this.state.pace })) * 3600;
    }
    return { ...escape, origin: from, returnSeconds: Math.ceil(seconds) };
  }

  /** One card per held encounter on this GM's client; redraws and clock ticks never reopen it. */
  async openHeldEncounter(p = this.progress()) {
    if (!game.user.isGM || p?.status !== "encounter" || !p.encounter?.id || !this.openEncounter) return;
    const e = p.encounter, own = (this.state.encounters ?? []).find((o) => o.id === e.id);
    if (e.generic && !e.notes && !e.img && !e.pinned && !e.images?.length && !e.actor && !e.actors?.length && !own?.pinned && !own?.img) return;
    const key = `${this.scene.partyId??''}|${journeyKey(this.state)}|${e.id}|${p.since}`;
    const opened = this.openedEncounterCards ??= new Set(); if (opened.has(key)) return;
    opened.add(key); if (opened.size > 64) opened.delete(opened.values().next().value);
    try { await this.showEncounterCard(e.id, !!own); } catch (err) { opened.delete(key); console.warn("kg-realms | encounter card:", err); }
  }
  showEncounterCard(id,own=false,options) { const e=this.plan?.encounters?.find(e=>e.id===id),key=e?.sourceId??id;return options===undefined?this.openEncounter?.(key,own):this.openEncounter?.(key,own,options); }
  #milesAt(hour) {
    const t = this.result?.track, m = this.trackMiles;
    if (!t?.length) return 0;
    let i = t.findIndex((p) => p.hour >= hour);
    if (i < 0) return m.at(-1);
    if (i === 0) return 0;
    const a = t[i - 1], b = t[i], f = (hour - a.hour) / Math.max(1e-9, b.hour - a.hour);
    return m[i - 1] + (m[i] - m[i - 1]) * f;
  }

  /** The GM's side: tokens to the party's place, questions at stops, news in the chat, players told. */
  #sync() {
    // One at a time: a tick while one runs is caught up once it finishes.
    if (this.syncWork) { this.again = true; return this.syncWork; }
    this.syncWork = (async () => {
      try { do { this.again = false; await this.#syncOnce(); } while (this.again); }
      finally { this.syncWork = null; }
    })();
    return this.syncWork;
  }

  async #syncOnce() {
    const scene = this.scene, epoch = this.lifecycleEpoch, generation = this.refreshGeneration, result = this.result, s = this.state, p = this.progress(), trip = journeyKey(s);
    if (!p || !this.result) { await this.syncBiome(); return; }
    if(this.unfocused&&p.made?.length){
      const decisions=[...(s.trip.decisions??[])],made=[...p.made];for(let i=0;made.length;i++){if(!decisions[i])decisions[i]=made.shift();}
      await writeJourney(scene,()=>({'trip.decisions':decisions}),{trip});
    }
    if(this.unfocused&&p.status==='encounter')this.onBackgroundEncounter?.(this,p);
    const valid = () => this.scene === scene && this.lifecycleEpoch === epoch && this.refreshGeneration === generation && this.result === result && this.leader && this.canSync?.() !== false && journeyKey(scene.getFlag(MODULE_ID, "journey")) === trip;
    if (!valid()) return;
    await this.syncBiome();if(!valid())return;
    if(p.status==="encounter"&&isHazard(p.encounter)&&p.encounter.autoDiscover!==false&&(p.encounter.visibility??"hidden")==="hidden"){
      await this.discoverHazard?.(p.encounter.sourceId??p.encounter.id);if(!valid())return;
    }
    const force = this.forceSnapshot; this.forceSnapshot = false;
    const at = this.#at(p.hour);
    // The party's tokens go to everyone, so while the party is on the move they are sent at most every
    // TOKEN_MOVE_MS of real time, gliding for as long; a stop, a camp, an encounter, arriving, a forced
    // update or a big jump in the clock moves them at once. A move held back is made when it falls due,
    // even if the clock stops in between (0.96.1).
    if (at) {
      const t = performance.now(), jump = Math.abs(p.hour - (s.now?.hour ?? p.hour)) > .5;
      const due = tokenMoveDue({ force: force || jump || this.motionDuration != null, status: p.status, lastStatus: this.lastMoveStatus, since: t - (this.lastTokenMove ?? -Infinity) });
      if (due) {
        clearTimeout(this.tokenMoveTimer); this.tokenMoveTimer = null;
        this.lastTokenMove = t; this.lastMoveStatus = p.status;
        await this.#moveTo(at, { scene, duration: this.motionDuration ?? (jump ? 8000 : p.status === "moving" ? TOKEN_MOVE_MS : 800) });
      } else if (!this.tokenMoveTimer) {
        this.tokenMoveTimer = setTimeout(() => { this.tokenMoveTimer = null; if (this.leader) this.#sync().catch((err) => console.warn("kg-realms | journey sync:", err)); }, Math.max(50, TOKEN_MOVE_MS - (t - this.lastTokenMove)));
      }
    }
    if (!valid()) return;
    // Each stop is announced once (chat, Perception rolls, the questions). What was announced is kept
    // with the journey, so reloading Foundry does not ask again. A journey from before 0.42.1 has no
    // record: the stop it was already at counts as announced.
    const key = progressKey(s, p);
    const old = s.now;
    const told = old?.told === key || (old && old.told == null && old.status === p.status && (old.encounter?.name ?? null) === (p.encounter?.name ?? null));
    if (!told && !this.asked.has(key)) {
      this.asked.add(key);
      if (this.asked.size > 128) this.asked.delete(this.asked.values().next().value);
      this.#announce(p);
      this.#logStop(p);
    }
    const snap = { hour: Math.round(p.hour * 100) / 100, walkFeet: this.routeFeet ?? this.speed().feet, status: p.status, sailing: !!p.sailing, until: p.until ?? null, since: p.since ?? null, night: p.night ?? null, limit: p.limit ?? null, camp: !!p.camp, campStart: p.campStart ?? null, dayHours: p.dayHours, encounter: p.encounter ? { id: p.encounter.id ?? null, ...(p.encounter.sourceId?{sourceId:p.encounter.sourceId}:{}), name: p.encounter.name, kind: p.encounter.kind ?? null } : null, told: key };
    if (valid() && snapshotNeeded(old, snap, { force })) await writeJourney(scene, () => ({ now: snap }), { trip, valid });
  }

  /* ------------------------------------------------------------------ travel log */
  // Each journey keeps a journal entry in the Travel Logs folder, made when the party sets off and
  // named for the journey and the day it left. Each time the party stops (an encounter, the end of
  // a day, a stay, a halt, a town) a dated line records how far it has come; arriving writes the
  // last line and closes the log. Planning and route edits are never logged. It is never opened.

  /** A world time as the calendar writes it (Calendaria's format when it is on). */
  dateText(t = this.clock, format = "datetime24") {
    const c = game.time.calendar?.timeToComponents?.(t) ?? game.time.components ?? {};
    const C = globalThis.CALENDARIA;
    try {
      if (C?.api?.formatDate) {
        const yz = C.managers?.CalendarManager?.getActiveCalendar?.()?.years?.yearZero ?? 0;
        const s = C.api.formatDate({ ...c, year: (c.year ?? 0) + yz, month: (c.month ?? 0) + 1, day: (c.dayOfMonth ?? 0) + 1 }, format);
        if (s) return s;
      }
    } catch { /* plain dates below */ }
    const v = game.time.calendar?.months?.values, months = Array.isArray(v) ? v : Object.values(v ?? {});
    const m = months[c.month]?.name ? game.i18n.localize(months[c.month].name) : `month ${(c.month ?? 0) + 1}`;
    const time = format.includes("time") ? `, ${String(c.hour ?? 0).padStart(2, "0")}:${String(c.minute ?? 0).padStart(2, "0")}` : "";
    return `${(c.dayOfMonth ?? 0) + 1} ${m} ${c.year ?? ""}${time}`.trim();
  }

  /** A stop the party has just reached, in the log. */
  #logStop(p) {
    const where = this.#near(this.#at(p.hour)), e = p.encounter;
    const text = {
      encounter: e?.kind === "town" ? `Reached ${esc(e.name)}.` : `Encounter: <b>${esc(e?.name ?? "Encounter")}</b>, ${p.camp ? "in camp " : ""}${where}${e?.dc != null ? ` (Perception DC ${e.dc})` : ""}.`,
      decide: `The day's travel ends ${where}, after ${hrs(p.dayHours ?? 0)} on the way.`,
      stay: `The party stays ${where} for ${this.#span(((p.until ?? p.since) - p.since) / 3600)}.`,
      halted: `Travel stops ${where}.`,
      arrived: `Arrived ${where}.`
    }[p.status];
    if (text) this.#log(text, { hour: p.hour, at: p.since, close: p.status === "arrived" });
  }

  /**
   * Add a line to the journey's log (null: only make sure it exists). hour: the travel hour it
   * stands at (for the miles), at: the world time. close: the last line, with the totals.
   * Lines are written one at a time, in order.
   */
  #log(text, { hour = null, at = this.clock, close = false } = {}) {
    if (!game.user.isGM) return;
    // Where the party stands is read now: by the time the line is written the route may be being worked out again.
    const r = this.result, sts = this.stops(), scene = this.scene, trip = journeyKey(this.state);
    const now = { hour, miles: hour != null && r ? this.#milesAt(hour) : null, day: hour != null && this.plan ? this.#dayAt(hour) : null, total: r ? { miles: r.miles, days: this.#dayAt(r.hours) } : null, sts };
    this.logging = (this.logging ?? Promise.resolve()).then(() => this.#writeLog(text, { at, close, now, scene, trip })).catch((err) => console.warn("kg-realms | travel log:", err));
    return this.logging;
  }

  async #writeLog(text, { at, close, now, scene, trip }) {
    const valid = () => this.scene === scene && this.leader && journeyKey(this.state) === trip;
    if (!valid()) return;
    const s = this.state, { sts } = now;
    if (!s.trip) return;
    let entry = s.trip.log ? game.journal.get(s.trip.log) : null;
    const title = (scene.partyId?`${partyLabel(scene)}: `:"") + (s.name || (sts.length > 1 ? `${this.stopTitle(sts[0], "Start")} to ${this.stopTitle(sts.at(-1), "End")}` : "Journey"));
    if (!entry) {
      const name = "Travel Logs";
      const folder = game.folders.find((f) => f.type === "JournalEntry" && f.name === name) ?? await Folder.create({ name, type: "JournalEntry" });
      if (!valid()) return;
      const plan = now.total ? `${mi(now.total.miles)} miles planned, about ${now.total.days} days` : "";
      const head = `<h2>${esc(title)}</h2><p>Set out from <b>${esc(sts[0]?.name ?? "the start")}</b> on ${esc(this.dateText(s.trip.departed))}${sts.length > 2 ? `, by way of ${sts.slice(1, -1).map((w) => esc(w.name ?? "a stop")).join(", ")}` : ""}, for <b>${esc(sts.at(-1)?.name ?? "the end")}</b>. ${plan}.</p>`;
      entry = await JournalEntry.create({ name: `${title}, ${this.dateText(s.trip.departed, "dateLong")}`, folder: folder?.id ?? null, pages: [{ name: "Log", type: "text", text: { content: head } }], flags: { [MODULE_ID]: { journey: true, partyId:scene.partyId??null, miles: 0 } } });
      if (!valid()) return;
      await this.save({ trip: { ...this.state.trip, log: entry.id } }, { undoable: false, scene, expectedTrip: trip });
    }
    if (!valid() || !text || entry.getFlag(MODULE_ID, "closed")) return;
    const page = entry.pages.contents[0];
    const was = entry.getFlag(MODULE_ID, "miles") ?? 0, miles = now.miles ?? was;
    const day = now.day != null ? `, day ${now.day}` : "";
    const progress = now.miles != null ? ` ${mi(miles)} mi travelled${miles - was >= 0.1 ? ` (${mi(miles - was)} since the last entry)` : ""}.` : "";
    let line = `<p><b>${esc(this.dateText(at))}${day}</b>: ${text}${progress}</p>`;
    if (close) {
      const days = Math.max(1, Math.ceil((at - s.trip.departed) / 86400 - 1e-9));
      line += `<p><i>Journey over: ${mi(miles)} miles in ${days} day${days === 1 ? "" : "s"}.</i></p>`;
    }
    await page?.update({ "text.content": `${page.text?.content ?? ""}${line}` });
    await entry.update({ [`flags.${MODULE_ID}.miles`]: miles, ...(close ? { [`flags.${MODULE_ID}.closed`]: true } : {}) });
  }

  #announce(p) {
    const s = this.state, where = this.#near(this.#at(p.hour));
    const say = (text, gmOnly = false) => ChatMessage.create({ content: `<p><i class="fa-solid fa-person-hiking"></i> ${text}</p>`, speaker: { alias: s.name || "Journey" }, ...(gmOnly ? { whisper: game.users.filter((u) => u.isGM).map((u) => u.id) } : {}) });
    if (p.status === "arrived") return say(`The party arrives ${where}.`);
    if (p.status === "stay") return say(`The party stays ${where} for ${hrs((p.until - p.since) / 3600)}.`);
    if(this.unfocused)return;
    if (p.status === "encounter" && p.encounter?.kind === "town") return this.#askTown(p);
    if (p.status === "encounter") {
      this.openHeldEncounter(p);
      const e = p.encounter, who = perceptionAgainst(this.party(), e.dc, s.pace);
      say(`<b>Encounter: ${esc(e.name)}</b> ${p.camp ? "in camp " : ""}${where}${e.dc != null ? `, Perception DC ${e.dc}` : ""}.${who.length && e.dc != null ? `<br>Passive Perception: ${who.map((c) => `${esc(c.name)} ${c.adjusted} ${c.notices ? "notices" : "misses it"}`).join(", ")}` : ""}${e.notes ? `<br>${esc(e.notes)}` : ""}`, true);
      // Each encounter says how it is noticed: the party rolls Perception (the default), or passive only.
      // In camp only the one on watch rolls, when the GM asks (the camp panel).
      if (e.dc != null && e.perception !== "passive" && !p.camp) this.requestPerception(e);
      return;
    }
    // The end of the day's travel: the camp panel holds the choice (make camp, or push on).
    if (p.status === "decide") return ui.notifications.info("KG Realms: the day's travel is over. Make camp or push on in the travel panel.");
  }

  /** Where the party is now, [lon, lat] (a random encounter in camp goes there), or null. */
  whereNow() {
    const p = this.progress(), at = p ? this.#at(p.hour) : null;
    return at ? this.toLonLat(at[0], at[1]) : null;
  }

  /**
   * Ask the party to roll Perception for an encounter: through Flash Token Bar 5e when it is active
   * (its roll request, to the party's actors, with the DC), else on dnd5e a chat card with the
   * system's Perception roll button for each player to click. The card never names the encounter.
   * The DC goes with the rolls when players may see it (Show Perception DC, or Tenacity active), so
   * the chat card shows success or failure and Tenacity can be spent on it.
   */
  async requestPerception(e) {
    const dc = e.dc != null && showDC() ? e.dc : null;
    const actors = this.members().filter((a) => a?.id);
    const flash = game.modules.get("flash-rolls-5e");
    try {
      if (flash?.active && flash.api?.requestRoll && actors.length) {
        return await flash.api.requestRoll({ requestType: "skill", rollKey: "prc", actorIds: actors.map((a) => a.id), dc: dc ?? undefined, sendAsRequest: true });
      }
    } catch (err) { console.warn("kg-realms | Flash Token Bar 5e roll request failed; asking in the chat instead:", err); }
    if (game.system.id !== "dnd5e") return ui.notifications.info("KG Realms: ask the party for Perception rolls (no roll request for this game system).");
    const names = actors.length ? ` (${actors.map((a) => esc(a.name)).join(", ")})` : "";
    return ChatMessage.create({
      content: `<p><i class="fa-solid fa-eye"></i> <b>Keep your eyes open.</b> Everyone${names}, make a Wisdom (Perception) check.</p><p>${dc != null ? `[[/skill skill=perception dc=${dc}]]` : "[[/skill perception]]"}</p>`,
      speaker: { alias: this.state.name || "Journey" }
    });
  }

  /** The party reaches a town with a local map: is it stopping there? */
  async #askTown(p) {
    const scene = this.scene, trip = journeyKey(this.state);
    const name = p.encounter.name;
    const stay = await RealmDialog.confirm({
      window: { title: `${name}` },
      content: `<p>The party reaches <b>${esc(name)}</b>.</p><p>Is the party stopping in ${esc(name)}?</p>`,
      yes: { label: `Stop in ${name}`, icon: "fa-solid fa-door-open" }, no: { label: "Carry on", icon: "fa-solid fa-play" },
      rejectClose: false
    }).catch(() => null);
    if (stay === null || stay === undefined || this.scene !== scene || !this.leader || journeyKey(this.state) !== trip) return;
    return this.#townChoice(!!stay);
  }

  /**
   * Stopping: travel on the realm map is paused (Stopped) until the GM resumes it, and the GM is
   * offered to activate the town's scene. Carrying on: the journey goes on as if nothing happened.
   */
  async #townChoice(stay) {
    const s = this.state, p = this.progress(), now = this.clock;
    if (!this.leader || p?.status !== "encounter" || p.encounter?.kind !== "town") return;
    const town = p.encounter, resumed = { ...(s.trip.resumed ?? {}), [town.id]: now };
    const halts = stay ? [...(s.trip.halts ?? []), { from: now, to: null }] : (s.trip.halts ?? []);
    await this.save({ trip: { ...s.trip, resumed, halts, ...(stay ? {townStop: {sceneId: town.sceneId, name: town.name, from: now, arrival: settlementArrivalMode(this.result, p.hour)}} : {}) } });
    if (!stay) return;
    ChatMessage.create({ content: `<p><i class="fa-solid fa-door-open"></i> The party stops in ${esc(town.name)}.</p>`, speaker: { alias: s.name || "Journey" } });
    return this.#enterStoppedTown();
  }

  async #enterStoppedTown() {
    if (!this.leader || this.enteringTown) return;
    const source = this.scene, trip = journeyKey(this.state), stop = this.state.trip?.townStop;
    const scene = stop && game.scenes.get(stop.sceneId);
    const valid = () => this.leader && this.scene === source && journeyKey(this.state) === trip && this.progress()?.status === 'halted' && this.progress()?.since === stop?.from;
    if (!scene || !valid()) return;
    this.enteringTown = true;
    try {
      const arrival = stop.arrival ?? settlementArrivalMode(this.result, this.progress()?.hour);
      const gate = await chooseSettlementGate(scene, {arrival});
      if (gate && valid()) return await this.enterTown(scene, gate, valid, arrival);
    } finally { this.enteringTown = false; }
  }

  /** The GM chooses land entries and multiple docks. A sole dock can be used directly. */
  async enterTown(scene, gateId, valid = () => this.leader, arrival = this.state.trip?.townStop?.arrival ?? 'land') {
    return enterSettlement(scene, gateId, {sourceScene: this.scene, globalActor: this.#get('partyActor'), valid, arrival});
  }

  async #decide(choice) {
    const s = this.state, p = this.progress();
    if (!p || p.status !== "decide") return;
    if (choice.rest || choice.push) choice = { ...choice, started: this.clock };
    const decisions = [...(s.trip.decisions ?? [])];
    decisions[p.stop] = choice;
    const say = (text) => ChatMessage.create({ content: `<p><i class="fa-solid fa-person-hiking"></i> ${text}</p>`, speaker: { alias: s.name || "Journey" } });
    if (choice.push) say(`The party pushes on for 1 hour.${p.limit + 1 > 8 ? ` At the end of the hour, each character makes a DC ${10 + (p.limit + 1 - 8)} Constitution saving throw or gains a level of exhaustion.` : ""}`);
    else say(`The party makes camp ${this.#near(this.#at(p.hour))} for ${choice.rest} hours.`);
    await this.save({ trip: { ...s.trip, decisions }, ...(choice.rest ? { rest: choice.rest } : {}) });
  }

  draw() {
    const layer = this.getLayer();
    if (!layer) return;
    const s = this.state, r = this.result, gm = game.user.isGM;
    if (this.stops().length < 2 || (!gm && s.show === "none")) return layer.setJourney(null);
    const ll = (p) => this.toLonLat(p[0], p[1]);
    const p = this.progress(), hour = p?.hour ?? 0;
    const marks = [];
    const progressOnly = !gm && s.show === "progress";
    let path = [], wet = [];
    if (r) {
      const shown = progressOnly ? r.track.filter((q) => q.hour <= hour) : r.track;
      path = shown.map((q) => ll(q.at));
      // On a boat, the line is blue.
      wet = shown.map((q) => !!r.legs[q.leg]?.sea);
      // A camp where each night falls ashore (none while a crewed ship sails on).
      for (const h of this.camps ?? []) {
        if (progressOnly && h > hour) break;
        marks.push({ at: ll(this.#at(h)), kind: h <= hour ? "done" : "camp" });
      }
    }

    // Numbered stops, named beside them.
    const nums = this.#numbers();
    if (gm || s.show === "route") s.waypoints.forEach((w, i) => {
      if (nums[i] == null) { if (gm) marks.push({ at: [w.lon, w.lat], kind: "via", selected: this.mode === "route" && this.selected === i }); return; }
      marks.push({ at: [w.lon, w.lat], label: `${nums[i]}`, name: this.#onPlace(w) ? "" : (w.name ?? ""), kind: "stop", selected: this.mode === "route" && this.selected === i });
    });
    // Encounters last, so a route point never hides one; the one being dragged follows the pointer.
    const drag = this.encDrag?.moved ? this.encDrag : null;
    if (gm) for (const e of s.encounters ?? []) marks.push({ at: drag?.id === e.id ? [drag.lon, drag.lat] : this.#placeOf(e), name: e.name, kind: "encounter", cardKey:journeyEncounterKey(this.scene,e.id) });
    const here = p ? this.#at(hour) : null;
    if (here) marks.push({ at: ll(here), name: "Party", kind: "here" });
    else if (gm && this.stops()[0]) { const f = this.stops()[0]; marks.push({ at: [f.lon, f.lat], name: "Start", kind: "here" }); }
    if (progressOnly && here) { path.push(ll(here)); wet.push(wet.at(-1) ?? false); }
    let parts=null;
    if(r?.track.some(q=>q.portalTransfer)){
      parts=[];let run={coords:[],wet:[]};
      const flush=()=>{if(run.coords.length>1)parts.push(run);run={coords:[],wet:[]};};
      for(const q of (progressOnly?r.track.filter(q=>q.hour<=hour):r.track)){
        if(q.portalTransfer){run.coords.push(ll(q.at));run.wet.push(false);flush();continue;}
        run.coords.push(ll(q.at));run.wet.push(!!r.legs[q.leg]?.sea);
      }flush();
    }
    layer.setJourney(path.length > 1 ? path : null, marks, wet,parts);
  }

  /* ------------------------------------------------------------------ panel */

  regionalBanner(progress) {
    const sample=this.result?.track.findLast(q=>q.hour<=(progress?.hour??0));
    if((!game.user.isGM&&this.state.show==="none")||!this.result?.track.some(q=>q.regionTitle))return "";
    const regional=sample?.regionTitle,gm=game.user.isGM;
    const title=regional?`In ${regional}: regional scale applies${sample.regionalFallback?" (realm terrain beyond the detailed picture)":""}`:'Realm scale applies outside regional coverage';
    return `<div class="tr-regional"><small>${esc(title)}</small>${gm?`<button type="button" data-act="regional-view" data-world="${esc(regional?sample.worldId:'')}">${regional?'Open regional map':'View realm map'}</button>${regional?'<button type="button" data-act="regional-view" data-world="">View realm map</button>':''}`:''}</div>`;
  }

  render() {
    if (!this.el || this.gripDrag) return;
    const scroll = captureScroll(this.el);
    // Typing in a field: hold the redraw until it loses focus (the clock redraws often). A ticked box
    // or a pressed button is done at once: the redraw shows it.
    // A new watch in camp: the watcher's portrait comes up for everyone (minimised or not); and the
    // camp scene, while it runs, over the map. Both for the players even with the journey hidden
    // from them (they roll their camp checks in the scene), and even while the panel's redraw waits.
    const p = this.stops().length >= 2 ? this.progress() : null;
    if (p) { this.camp.watchChanged(p); this.camp.renderScene(p); } else this.camp.renderScene(null);
    const f = document.activeElement;
    if (f && this.el.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && !["button", "checkbox", "radio"].includes(f.type)) {
      // The journey moved on (camp made, the rest begun, dawn): the field is let go, the panel follows.
      const stage = p ? `${p.status}|${p.night ?? ""}|${this.state.watch?.setup ?? ""}` : "";
      if (stage === this.stage) { this.held = true; return; }
      f.blur();
    }
    this.held = false;
    this.stage = p ? `${p.status}|${p.night ?? ""}|${this.state.watch?.setup ?? ""}` : "";
    const gm = game.user.isGM, s = this.state, r = this.result;
    const rulesOnly = !gm && (s.show === "none" || this.stops().length < 2);
    this.el.hidden = !!this.suspended;
    this.el.classList.toggle("collapsed", this.collapsed);
    const sts = this.stops();
    const title = rulesOnly ? "Travel rules" : !gm && s.show === "progress" ? "Journey progress" : s.name || (sts.length > 1 ? `${this.stopTitle(sts[0], "Start")} to ${this.stopTitle(sts.at(-1), "End")}` : "Travel");
    const parties=sceneParties(this.scene?.realScene??this.scene);
    const partyTabs=parties.length>1?`<nav class="kgr-party-tabs" aria-label="Travel party">${parties.map(t=>`<button data-party-focus="${esc(t.actor.id)}" class="${t.actor.id===this.scene.partyId?'on':''}" ${this.leader?'':'disabled'}>${esc(t.name)}${(this.scene.realScene??this.scene).getFlag(MODULE_ID,'partyJourneys')?.[t.actor.id]?.now?.status==='encounter'?' !':''}</button>`).join('')}</nav>`:'';
    // The shell's header (ui-shell.mjs); the party pills sit under it.
    const head = shellHead({ icon: "fa-person-hiking", eyebrow: "Travel", title, lock: { attr: 'data-act="lock"', on: this.locked }, min: { attr: 'data-act="collapse"', on: this.collapsed } }) + partyTabs + this.regionalBanner(p);
    if (rulesOnly) { this.panelHtml = null; renderPanel(this.el, head + (this.collapsed ? "" : `<nav class="kgr-tabs"><button data-tab="rules" class="on">Rules</button></nav><div class="body">${this.#rulesTab()}</div>`)); this.#place(); restoreScroll(this.el, scroll); return; }
    if (this.collapsed) { this.panelHtml = null; renderPanel(this.el, head + this.#pinned(this.camp.stage(p) === "decide" ? this.camp.html(p) : "")); this.#place(); restoreScroll(this.el, scroll); return; }
    const pace = PACES[s.pace], sp = this.speed(), base = sp.feet / 10, mph = base * pace.mph / 3;
    const seg = (name, value, list) => `<div class="seg">${list.map(([v, l, t]) => `<button data-set="${name}" data-value="${v}" class="${v === value ? "on" : ""}" ${t ? `title="${esc(t)}"` : ""}>${l}</button>`).join("")}</div>`;
    const R = this.ruleText();
    const method = METHODS[s.method] ? s.method : "foot", own = method === "custom" || method === "flying", coachMph = s.coachMph ?? METHODS.coach.roadMph;
    // Miles a day at each pace for the party's way of travel, on open ground.
    const daily = (k) => method === "flying" || method === "custom" ? (s.methodMph ?? 8) * s.hours : (method === "foot" ? base : method === "coach" ? coachMph : 3) * PACES[k].mph / 3 * s.hours;
    const paceSeg = seg("pace", s.pace, ["slow", "normal", "fast"].map((k) => [k, `${PACES[k].label} <small>${mi(daily(k) / s.hours)} mph</small>`, R.pace[k]]));
    const showText = { route: "players see the route", progress: "players see progress only", none: "players see nothing" }[s.show] ?? "";
    // The setup, folded into one line once a route exists (the Setup button opens it again).
    const open = gm && !!this.setupOpen;
    // Someone encumbered (on foot, it slows the party): in red, with who and how.
    const load = sp.burdened.map((x) => `${x.name}: ${x.burden}`).join(", ");
    const how = method === "foot" ? `<span class="${sp.burden ? "burdened" : ""}" ${load ? `data-tooltip="${esc(`Encumbered: ${load}. Lighten the load to travel faster.`)}"` : ""}>speed ${sp.feet} ft${sp.who ? ` (${esc(sp.who)}, slowest${sp.burden ? `, ${esc(sp.burden)}` : ""})` : ""}</span>${sp.burdened.length && !sp.burden ? ` · <span class="burdened" data-tooltip="${esc(`Encumbered: ${load}.`)}">${esc(sp.burdened.map((x) => x.name.split(" ")[0]).join(", "))} encumbered</span>` : ""}` : own ? `${mi(s.methodMph ?? 8)} mph` : METHODS[method].offroad ? "roads and trails only" : "travel pace";
    const biome=this.currentBiome(), favored=this.favoredTerrains().includes(biome?.type);
    // The setup, in one line: how the party travels, and the day.
    const aboard = p?.sailing ? this.result?.legs.find((l) => l.sea && l.start <= p.hour + 1e-6 && l.start + l.hours > p.hour) : null, aboardIdx = aboard ? this.result.legs.indexOf(aboard) : -1;
    const summary = `${gm&&this.getDestinations?'<button type="button" data-act="find-destination" class="wide">Find destination in realm or regional map</button>':''}<div class="tr-setup"><div class="grow"><b>${esc(METHODS[method].short)}, ${esc(pace.label.toLowerCase())} pace</b><small>${aboard ? `This leg: ${esc(this.vessel(s.legVessels?.[aboardIdx]).label.toLowerCase())}` : `${both(daily(s.pace))} a day · ${s.hours} h road · ${s.rest} h camp · ${how}`}</small></div>${gm ? `<button data-act="setup" class="${open ? "on" : ""}">${open ? "Done" : "Setup"}</button>` : ""}</div>`;
    const fr = { ...DEFAULT.fares, ...(s.fares ?? {}) };
    const settings = open ? `${summary}
      <div class="row"><label>Name<input type="text" name="name" value="${esc(s.name)}" placeholder="${esc(title)}"></label></div>
      <div class="row"><label>Travelling by ${rule(R.method)}</label><div class="seg wrap">${Object.entries(METHODS).map(([k, m]) => `<button data-set="method" data-value="${k}" class="${k === method ? "on" : ""}">${esc(m.short)}</button>`).join("")}</div></div>
      ${own ? `<div class="row"><label>${method === "flying" ? "Flying speed" : "Speed"} <input type="number" name="methodMph" min="0.5" max="30" step="0.5" value="${s.methodMph ?? 8}"> mph</label></div>` : ""}
      ${method === "coach" ? `<div class="row"><label>Speed on roads, at normal pace <input type="number" name="coachMph" min="1" max="30" step="0.5" value="${coachMph}"> mph</label></div>` : ""}
      <div class="hint">${ruleContent(R.methods[method])}<p>Boats are chosen per leg, at ports and on rivers you drew.</p></div>
      <div class="row"><label>Pace ${rule(R.paceAll)}</label>${paceSeg}</div>
      <div class="grid2">
        <label><span>Hours on the road ${rule(R.forced)}</span><input type="number" name="hours" min="1" max="16" value="${s.hours}"></label>
        <label>Hours in camp<input type="number" name="rest" min="1" max="72" value="${s.rest}"></label>
      </div>
      <div class="row"><label><span>Ship fare, a mile ${rule(R.fares)}</span><span class="unit"><input type="number" name="fare-ship" min="0" max="100" step="0.5" value="${fr.ship}"> sp</span></label></div>
      ${[["wagon", "Wagon", "Paid to guard"], ["coach", "Coach", "Paid as escort"]].map(([k, label, paid]) => {
        const term = { ...RIDE_DEALS.terms, ...s.terms }[k], rate = term === "paid" ? { ...RIDE_DEALS.pays, ...s.pays }[k] : { ...RIDE_DEALS.fares, ...s.fares }[k];
        return `<div class="grid2"><label>${label}<select name="term-${k}">${[["fare", "Party pays"], ["free", "Free ride"], ["paid", paid]].map(([v, l]) => `<option value="${v}" ${v === term ? "selected" : ""}>${l}</option>`).join("")}</select></label>${term === "free" ? "" : `<label>${term === "paid" ? "Pay" : "Fare"}, a mile each<span class="unit"><input type="number" name="rate-${k}" min="0" max="1000" step="1" value="${rate}"> cp</span></label>`}</div>`;
      }).join("")}
      <div class="row"><label>Players see ${rule(R.show)}</label>${seg("show", s.show, [["route", "Route"], ["progress", "Progress"], ["none", "Nothing"]])}</div>`
      : summary;
    // The route: one row for each stop, which opens to how the leg goes and what can be done there.
    const sh = this.sheet, nums = this.#numbers(), pr = this.progress();
    const progressOnly = !gm && s.show === "progress", nowHour = pr?.hour ?? 0;
    const the = (x) => (x.startsWith("the ") ? x : `the ${x}`);
    const dayOf = (h) => this.#dayAt(h);
    const days = (hours, perDay) => { const d = Math.max(1, Math.ceil(hours / perDay)); return `${d} day${d === 1 ? "" : "s"}`; };
    const noBoat = (leg) => { const here = this.boatAt(sts[leg + 1]), who = this.stopTitle(here ? sts[leg] : sts[leg + 1], "This stop"); return `<span class="leg-explain">${here ? `The stop before this one, ${esc(who)},` : `${esc(who)}`} has no port or drawn river, so this leg has no boat option.</span>`; };
    // How one leg goes, for the GM: Land or each way by water, in plain words, with its boat or method and fare.
    const legHow = (leg) => {
      const L = r?.legs[leg];
      if (!L) return "";
      const direct = s.legModes?.[leg] === "direct", done = pr && L.start + L.hours <= pr.hour + 1e-6;
      const legMethod = s.legMethods?.[leg] ?? null, flying = (legMethod ?? s.method) === "flying", roadsOnly = !!METHODS[legMethod ?? s.method]?.roadsOnly;
      const v = L.sea ? this.vessel(s.legVessels?.[leg]) : null, ch = this.legChoices?.[leg], way = L.sea ? this.#wayOf(leg, L) : "land";
      const opt = (value, label, on) => `<option value="${esc(value)}" ${on ? "selected" : ""}>${esc(label)}</option>`;
      const sel = L.sea
        ? `<label class="leg-ship">Boat <select name="ship-${leg}" ${done ? "disabled" : ""}>${Object.entries(VESSELS).map(([k, x]) => opt(k, `${x.label}, ${x.mph} mph${x.crewed ? ", day and night" : ", 8 h a day"}`, v.key === k)).join("")}${v?.actor ? opt(v.key, v.label, true) : ""}</select> ${rule(R.vessels)}</label>`
        : `<label class="leg-ship">Travelling by <select name="how-${leg}" ${done ? "disabled" : ""}>${opt("", `${METHODS[s.method]?.short ?? "On foot"} (journey default)`, !legMethod)}${Object.entries(METHODS).filter(([k]) => k !== s.method).map(([k, m]) => opt(`m:${k}`, m.label, legMethod === k)).join("")}</select> ${rule(R.method)}</label>`;
      const roads = !L.sea && !flying && !roadsOnly && !done ? `<span class="leg-ways"><button type="button" ${direct ? `data-act="way" data-i="${leg}"` : 'class="on"'} aria-pressed="${!direct}">By road<small>Roads where they save time</small></button><button type="button" ${direct ? 'class="on"' : `data-act="way" data-i="${leg}"`} aria-pressed="${direct}">Direct<small>Straight across country</small></button></span>` : "";
      // The choice for this leg: land, and each way by water that exists, each with what it costs.
      const choice = (key, label, o, perDay) => `<button type="button" data-act="leg-way" data-i="${leg}" data-value="${key}" class="${way === key ? "on" : ""}" aria-pressed="${way === key}" ${done || !o ? "disabled" : ""}>${label}<small>${o ? `${mi(o.miles)} mi, ${days(o.hours, perDay)}` : "no way by land"}</small></button>`;
      const boatDay = ch?.vessel.crewed ? 24 : 8;
      const ask = ch ? `<span class="leg-q">How does the party get to ${esc(this.stopTitle(sts[leg + 1], "the next stop"))}? ${rule(R.ways)}</span><span class="leg-ways">${choice("land", "Land", ch.land, s.hours)}${ch.boat.map((o) => choice(o.key, WAY_LABELS[o.key], o.plan, boatDay)).join("")}</span>` : noBoat(leg);
      // In plain words: where the party boards, where it lands, and whether that is the end.
      const aboard = (s.waypoints[leg]?.bypassed?.length ?? 0) > 0, boardAt = L.sea ? this.boatAt(sts[leg]) : "", landAt = L.sea ? this.boatAt(sts[leg + 1]) : "";
      const placed = (x) => (x.startsWith("the ") ? `on <b>${esc(x)}</b>` : `at the <b>${esc(x)}</b>`);
      const explain = boardAt && landAt ? `<span class="leg-explain">The party boards ${placed(boardAt)} and ${aboard ? "stays aboard to" : "lands"} ${aboard ? `<b>${esc(the(landAt))}</b>` : placed(landAt)}, ${leg + 1 === sts.length - 1 ? "the destination" : "the next stop"}.</span>` : "";
      const parts = L.sea && way === "both" ? voyageParts(L.plan, HARBOUR_MI).map((q) => `<span class="leg-part"><b>${q.kind === "river" ? "River route" : "Sea route"}</b><span>${mi(q.miles)} mi, ${days(q.hours, boatDay)}</span>${q.names.length ? `<small>${esc(q.names.join(", "))}</small>` : ""}</span>`).join("") : "";
      const fare = this.fareOf(leg);
      const fareRow = fare ? `<span class="fare"><label>${fare.paid ? "Pay" : "Fare"} <input type="number" name="fare-${leg}" min="0" step="0.1" value="${gp(fare.gp)}"> gp a head</label>${rule(R.fares)}${fare.haggled ? `<small class="haggled">haggled, default ${gp(fare.def)} gp</small><button data-act="fare-reset" data-i="${leg}" class="link">Reset</button>` : `<small>default</small>`}</span>` : "";
      const drop = L.sea ? `<span class="ship-drop" data-leg="${leg}" title="Drop a ship (a water vehicle actor) here to sail on it">${v.img ? `<img src="${esc(v.img)}" alt="">` : '<i class="fa-solid fa-ship"></i>'} Drop a ship (a water vehicle actor) here to sail on it.</span>` : "";
      const warn = L.autoSea && !ch ? `<span class="warn-line"><i class="fa-solid fa-ship"></i> No way overland: going by boat.</span>` : "";
      const crossing = (this.riverOffers ?? []).filter((o) => o.leg === leg).map((o) => `<span class="tr-offer"><b>The road crosses ${esc(riverLabel(o.river))}</b><span>Land to the crossing: ${mi(o.landMiles)} mi, ${days(o.landHours, s.hours)}. River route to ${esc(the(this.boatAt(sts[leg + 1])))}: ${mi(o.plan.miles)} mi, ${days(o.plan.hours, 8)}.</span><span class="row"><button type="button" data-act="river-take" data-i="${leg}" class="primary">Take the river route from the crossing</button><button type="button" data-act="river-skip" data-i="${leg}">Stay on the road</button></span></span>`).join("");
      return `<div class="leg-how">${ask}${explain}${parts}${sel}${roads}${drop}${fareRow}${warn}${crossing}</div>`;
    };
    // Quicker ways by ship from a port: offered in the leg they would replace.
    const shipOffers = (from, to) => (this.shipHints ?? []).map((h, k) => (h.a.node < from || h.a.node >= to ? "" : `<div class="tr-offer"><b><i class="fa-solid fa-ship"></i> Faster by ship from the port of ${esc(h.a.p.name)}</b>
      ${h.options.map((o, j) => `<div class="ship-opt"><div class="grow"><span>To the port of ${esc(o.b.p.name)}: ${this.#span(o.sea.hours)}, saves ${this.#span(o.land - o.sea.hours)}, ${gp(o.fare)} gp a head.</span>
        ${o.calls.length ? `<small>Calling at ${o.calls.map((c) => esc(c.p.name)).join(", ")}: the party can stop there.</small>` : ""}
        ${o.skips.length ? `<small class="skip">Skips ${o.skips.map((c) => esc(c.name)).join(", ")} (not a port).</small>` : ""}</div>
        <button type="button" data-act="ship-take" data-i="${k}" data-o="${j}" class="primary">Sail</button></div>`).join("")}
      <span class="sub">Sailing ship, day and night. Stops with a stay are not sailed past.</span>
      <button type="button" data-act="ship-skip" data-i="${k}" title="No ship from here: the party goes on overland (this offer goes away)">Stay overland</button></div>`)).join("");
    const starts = [];
    if (sh) sh.nodes.forEach((n, i) => { if (i === 0 || n.stop != null) starts.push(i); });
    const order = s.waypoints.map((w, i) => i).filter((i) => nums[i] != null), nextAt = pr && pr.status !== "arrived" && sh ? starts.slice(1).findIndex((i) => sh.nodes[i].hour > nowHour + 1e-6) : -1;
    const startRow = () => `<div class="tr-stop start"><div class="tr-row"><span></span><span class="n"><i class="fa-solid fa-person-hiking" aria-label="The party"></i></span><span class="t"><b>${esc(this.stopTitle(sts[0], "Start"))}</b>${(() => { const [lon, lat] = [sts[0]?.lon, sts[0]?.lat], around = sts[0] ? spotRealms(lon, lat, this.getPlaces()) : ""; return around && !/^(In|On|Near|near)\s/.test(sts[0]?.name ?? "") ? `<small class="stop-where">In ${esc(around)}</small>` : ""; })()}${this.seaNodes?.has(0) ? `<small class="sea-available">${esc(this.seaNodes.get(0))}</small>` : ""}</span></div></div>`;
    // Stops the boat sails past, listed just above the stop it lands at.
    const bypassedRows = (k) => (s.waypoints[k - 1]?.bypassed ?? []).map((b, j) => `<div class="tr-stop bypassed"><div class="tr-row"><span class="t"><b>${esc(b.name ?? "Stop")}</b><small>Bypassed. The boat does not call here.</small></span>${gm ? `<button type="button" data-act="stop-here" data-i="${k - 1}" data-b="${j}">Stop here</button>` : ""}</div></div>`).join("");
    const stopRow = (g) => {
      const i = starts[g + 1], n = sh.nodes[i], prev = sh.nodes[starts[g]], k = n.stop, w = s.waypoints[k - 1], end = starts[g + 2] ?? sh.nodes.length;
      const done = !!pr && n.hour <= nowHour + 1e-6, here = g === nextAt, open = !!this.openLegs?.has(g);
      const movable = gm && order.length > 1 && order.includes(k - 1) && !done;
      const grip = movable ? `<button type="button" class="stop-grip" data-grip="${k - 1}" aria-label="Drag to change the order of ${esc(n.name)}" title="Drag up or down to change the order"><i class="fa-solid fa-grip-vertical"></i></button>` : "<span></span>";
      const legs = [...new Set(sh.segments.slice(starts[g], i).filter(Boolean).map((x) => x.leg))];
      const lastLeg = r?.legs[legs.at(-1)], way = lastLeg?.sea ? WAY_LABELS[this.#wayOf(legs.at(-1), lastLeg)] : "Land";
      const stay = s.stays[k - 1] > 0 ? `stays ${s.stays[k - 1]} d` : "";
      const line = [way, w?.bypassed?.length ? "stays aboard" : "", stay, this.seaNodes?.get(i)?.split(":")[0]].filter(Boolean).join(" · ");
      const span = Math.max(1, dayOf(n.hour) - dayOf(prev.hour));
      const head = `<div class="tr-row" data-act="leg-fold" data-g="${g}" role="button" tabindex="0" aria-expanded="${open}">${grip}<span class="n">${nums[k - 1] ?? k}</span><span class="t"><b title="${esc(n.name)}">${esc(n.name)}</b><small class="${lastLeg?.sea ? "wet" : "dry"}">${esc(line)}</small></span><span class="r"><b>${mi(n.miles - prev.miles)} mi</b>${span} day${span === 1 ? "" : "s"} · day ${dayOf(n.hour)}</span>${foldCaret(open)}</div>`;
      const before = order[order.indexOf(k - 1) - 1] ?? -1, points = [];
      for (let q = before + 1; q < k - 1; q++) if (nums[q] == null) points.push(q);
      const vias = gm && points.length ? `<ol class="tr-vias" aria-label="Route points on the way to ${esc(n.name)}">${points.map((q) => { const x = s.waypoints[q], c = this.toSource(x.lon, x.lat); return `<li class="${this.mode === "route" && this.selected === q ? "sel" : ""}"><span class="dot" aria-hidden="true"></span><button type="button" class="tr-via" data-act="goto" data-x="${c[0]}" data-y="${c[1]}" data-i="${q}" title="Show this route point on the map">${esc(x.name ?? "Route point")}</button><small>route point</small>${done ? "" : `<button type="button" class="tr-via-del" data-act="del" data-i="${q}" title="Remove this route point" aria-label="Remove this route point"><i class="fa-solid fa-xmark"></i></button>`}</li>`; }).join("")}</ol>` : "";
      if (!open) return bypassedRows(k) + `<div class="tr-stop ${done ? "done" : ""} ${here ? "here" : ""} ${this.mode === "route" && this.selected === k - 1 ? "sel" : ""}" ${movable ? `data-stop-i="${k - 1}"` : ""}>${vias}${head}</div>`;
      const nextBoat = gm && k < sts.length - 1 && r?.legs[k - 1]?.sea && !done && !(s.stays[k - 1] > 0) ? this.boatAt(sts[k + 1]) : "";
      const landAfter = nextBoat && !r?.legs[k]?.sea;
      const bypass = nextBoat ? `<button type="button" data-act="bypass" data-i="${k - 1}" class="wide">Bypass ${esc(n.name)}: stay aboard to ${esc(the(nextBoat))}</button>${landAfter ? `<small class="sub">The leg after it is by land now, so this also makes it a boat leg.</small>` : ""}` : "";
      const around = !/^(In|On|Near|near)\s/.test(n.name ?? "") ? (() => { const [lon, lat] = this.toLonLat(n.at[0], n.at[1]), x = spotRealms(lon, lat, this.getPlaces()); return x ? `<small class="stop-where">In ${esc(x)}</small>` : ""; })() : "";
      // Places passed and roads joined, folded away.
      const inside = sh.nodes.slice(starts[g] + 1, i), placesOpen = !!this.openPlaces?.has(g);
      const places = inside.length ? `<button type="button" class="tr-fold" data-act="leg-places" data-g="${g}" aria-expanded="${placesOpen}">${foldCaret(placesOpen)} Places on this leg (${inside.length})</button>${placesOpen ? `<ul class="tr-places">${sh.segments.slice(starts[g], i).map((seg, j) => { const p = sh.nodes[starts[g] + j]; return `${j ? `<li><b>${esc(p.name)}</b><span>${mi(p.miles)} mi · day ${dayOf(p.hour)}</span></li>` : ""}${seg ? `<li class="via"><span>${esc(seg.via)}</span><span>${mi(seg.miles)} mi · ${hrs(seg.hours)}</span></li>` : ""}`; }).join("")}</ul>` : ""}` : "";
      const tools = gm ? `<span class="stop-tools"><label class="stay" title="Days to stay here">Stay <input type="number" min="0" max="60" name="stay-${k - 1}" value="${s.stays[k - 1] ?? 0}"> d</label><button type="button" data-act="goto" data-x="${n.at[0]}" data-y="${n.at[1]}" data-i="${k - 1}">Show on the map</button></span>${bypass}<button type="button" data-act="del" data-i="${k - 1}" class="wide">Remove this stop</button>` : "";
      return bypassedRows(k) + `<div class="tr-stop open ${done ? "done" : ""} ${here ? "here" : ""} ${this.mode === "route" && this.selected === k - 1 ? "sel" : ""}" ${movable ? `data-stop-i="${k - 1}"` : ""}>${vias}${head}<div class="tr-detail">${around}${gm ? legs.map(legHow).join("") + shipOffers(starts[g], end) : ""}${tools}${places}</div></div>`;
    };
    // A player following progress only sees the stops already reached.
    const shownStops = sh ? starts.slice(1).map((_, g) => g).filter((g) => !progressOnly || sh.nodes[starts[g + 1]].hour <= nowHour + 1e-6) : [];
    const stopCount = order.length, bypassCount = s.waypoints.reduce((a, w) => a + (w.bypassed?.length ?? 0), 0);
    const routeCap = !sh ? `${stopCount} stop${stopCount === 1 ? "" : "s"}` : pr?.status === "arrived" ? "Arrived" : pr?.status === "stay" && nextAt >= 0 ? `At stop ${nextAt} of ${stopCount}` : nextAt >= 0 ? `Next: stop ${nextAt + 1} of ${stopCount}` : `${stopCount} stop${stopCount === 1 ? "" : "s"}${bypassCount ? `, ${bypassCount} bypassed` : ""}`;
    // No route to draw: the stops as they are, and what is wrong with the leg that failed.
    const failedLeg = this.noRoute ? this.noRouteWhy?.leg ?? 0 : -1;
    const failed = !gm || this.stops().length < 2 ? ""
      : this.routeError ? `<p class="warn"><i class="fa-solid fa-circle-exclamation"></i> The route could not be worked out: ${esc(this.routeError)}. Try Recalculate the route (More); the console (F12) has the details.</p>`
      : this.noRoute && this.noRouteWhy?.roadOnly ? (() => { const w = this.noRouteWhy, who = METHODS[w.roadOnly].short.toLowerCase(); return `<p class="warn"><i class="fa-solid fa-circle-exclamation"></i> A ${esc(who)} goes only by road and trail. ${w.offRoad ? `${esc(w.offRoad.name)} is ${Number.isFinite(w.offRoad.miles) ? `${mi(w.offRoad.miles)} mi from the nearest one` : "not near one, and this map has none"}: move the stop to a road, or choose another way for this leg.` : `No road or trail joins ${esc(w.from)} and ${esc(w.to)}: draw one on the Roads tab, or choose another way for this leg.`}</p>`; })()
      : this.noRoute ? (() => { const w = this.noRouteWhy; return `<p class="warn"><i class="fa-solid fa-circle-exclamation"></i> No way found${w ? ` from ${esc(w.from)} (on ${esc(w.fromOn)}) to ${esc(w.to)} (on ${esc(w.toOn)})` : " between these stops"}. Water is in the way and no boat route joins them${w && (w.fromOn === "water" || w.toOn === "water") ? `: ${esc(w.toOn === "water" ? w.to : w.from)} stands on water (the map's own, a shoreline's water side, or a painted biome)` : ""}. If that is wrong, check the shorelines: on the Waterways tab, Show the map's water, and look for a shoreline whose water leaks round an open end. The console (F12) has the details.</p>`; })() : "";
    const unrouted = () => sts.slice(1).map((w, i) => { const opt = (value, label, on) => `<option value="${esc(value)}" ${on ? "selected" : ""}>${esc(label)}</option>`; const legMethod = s.legMethods?.[i] ?? null; return `<div class="tr-stop ${i === failedLeg ? "open" : ""}"><div class="tr-row"><span></span><span class="n">${i + 1}</span><span class="t"><b>${esc(this.stopTitle(w, "Stop"))}</b><small class="dry">${i === failedLeg ? "No way found" : ""}</small></span></div>${i === failedLeg ? `<div class="tr-detail">${failed}${gm ? `<label class="leg-ship">Travelling by <select name="how-${i}">${opt("", `${METHODS[s.method]?.short ?? "On foot"} (journey default)`, !legMethod)}${Object.entries(METHODS).filter(([k]) => k !== s.method).map(([k, m]) => opt(`m:${k}`, m.label, legMethod === k)).join("")}</select></label><button type="button" data-act="del" data-i="${i}" class="wide">Remove this stop</button>` : ""}</div>` : ""}</div>`; }).join("");
    const list = sts.length ? `<section class="tr-sec"><div class="tr-cap">Route<span class="kgr-sh-sp"></span>${progressOnly ? "" : esc(routeCap)}</div>${startRow()}${sh ? shownStops.map(stopRow).join("") : unrouted()}</section>` : "";
    const hint = this.mode === "route" ? `<p class="hint edit"><b>Editing the route.</b> ${s.waypoints.length ? "Click a place to add a stop. Click the route to add a point, then drag it to pull the path. Right-click a stop to remove it." : "Click the place the journey ends."} Ctrl+Z undoes. Esc to finish.</p>`
      : this.mode === "encounter" ? `<p class="hint edit"><b>Adding encounters.</b> Click the route to place one. Drag one to move it along the route. Click one to edit it, right-click to remove it. Ctrl+Z undoes. Esc to finish.</p>`
      : sts.length < 2 && !gm ? `<p class="hint">No route yet.</p>` : "";
    // Places to search by name, for choosing the end or adding a stop.
    const placeList = () => {
      const all = this.getPlaces();
      if (this.placeListFor !== all) { this.placeListFor = all; this.placeListHtml = `<datalist id="kgr-route-places">${[...new Set(all.filter((p) => !p.hidden && p.name && !(p.unnamed && !p.edited) && !["Road", "Trail"].includes(p.class)).map((p) => p.name))].sort().map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>`; }
      return this.placeListHtml;
    };
    const whereTo = gm && !s.waypoints.length ? `<div class="where-to"><label for="kgr-where">Where to?</label><input id="kgr-where" name="where" list="kgr-route-places" placeholder="Search for a place" autocomplete="off">${placeList()}${this.mode === "route" ? `<span>Or click a place on the map.</span>` : `<button type="button" data-act="edit"><i class="fa-solid fa-location-crosshairs"></i> Pick on the map</button>`}</div>` : "";
    const addHelp = `<small class="sub">A new stop goes where it adds the least distance. Drag its handle to move it.</small>`;
    const addStop = gm && s.waypoints.length && pr?.status !== "arrived" ? (this.addingStop || this.mode === "route" ? `<div class="add-stop"><label for="kgr-add-place">Add a stop</label><input id="kgr-add-place" name="add-place" list="kgr-route-places" placeholder="Search for a place" autocomplete="off">${placeList()}<span>Or click a place on the map.</span>${addHelp}${this.addingStop ? `<button type="button" data-act="add-stop">Done adding stops</button>` : ""}</div>` : `<div class="add-stop"><button type="button" data-act="add-stop"><i class="fa-solid fa-plus"></i> Add stop</button>${addHelp}</div>`) : "";
    const ground = r ? (() => { const t = r.ground.road + r.ground.trail + r.ground.offroad + r.ground.water || 1; return [["by water", r.ground.water], ["road", r.ground.road], ["trail", r.ground.trail], ["overland", r.ground.offroad]].filter(([, v]) => v / t >= 0.01).map(([k, v]) => `${Math.round(v / t * 100)}% ${k}`).join(", "); })() : "";
    // Nights out: in camp, aboard ship, or staying somewhere on the way.
    const nights = r ? Math.max(0, Math.ceil(elapsedAt(this.plan, r.hours, { hoursPerDay: s.hours, rest: s.rest }) / 24 - 1e-9) - 1) : 0;
    const priced = r ? r.legs.map((l, i) => this.fareOf(i)).filter(Boolean) : [], heads = this.members().length || 1;
    const fares = priced.filter((x) => !x.paid).reduce((a, x) => a + x.gp, 0), earned = priced.filter((x) => x.paid).reduce((a, x) => a + x.gp, 0);
    const totalDays = r ? this.#dayAt(r.hours) : 0, encCount = gm ? this.plan?.encounters.filter((e) => e.kind !== "town").length ?? 0 : 0;
    const sumGrid = r ? `<div class="tr-sum"><span>Distance</span><b>${both(r.miles)}</b><span>Time</span><b>${totalDays} day${totalDays === 1 ? "" : "s"}, about ${nights} night${nights === 1 ? "" : "s"}</b><span>Ground</span><b>${ground}</b>${fares ? `<span>Fares</span><b>${gp(fares)} gp a head${heads > 1 ? `, ${gp(fares * heads)} gp for ${heads}` : ""}</b>` : ""}${earned ? `<span>Pay</span><b>${gp(earned)} gp a head${heads > 1 ? `, ${gp(earned * heads)} gp for ${heads}` : ""}</b>` : ""}${encCount ? `<span>Encounters</span><b>${pr?.status === "arrived" ? `${encCount} met` : `${encCount} on the way`}</b>` : ""}</div>` : "";
    // The whole journey: open while planning and at the end, folded on the way.
    const underWay = !!pr && pr.status !== "arrived", journeyOpen = !underWay || !!this.journeyOpen;
    const journey = !r || progressOnly ? "" : underWay ? `<button type="button" class="tr-fold" data-act="journey-fold" aria-expanded="${journeyOpen}">${foldCaret(journeyOpen)} The journey: ${mi(r.miles)} mi, ${totalDays} day${totalDays === 1 ? "" : "s"}</button>${journeyOpen ? sumGrid : ""}` : `<section class="tr-sec"><div class="tr-cap">The journey</div>${sumGrid}</section>`;
    // The camp: a tab of its own while camp is being set up and through the night. End of the day is
    // a decision in the pinned part; the night watch at sea sits above the route.
    const stage = this.camp.stage(pr), inCamp = stage === "setup" || stage === "night", campHtml = stage ? this.camp.html(pr) : "";
    if (inCamp !== !!this.wasInCamp) { this.wasInCamp = inCamp; if (inCamp) this.tab = "camp"; else if (this.tab === "camp") this.tab = "route"; }
    else if (!inCamp && this.tab === "camp") this.tab = "route";
    const pinned = this.#pinned(stage === "decide" ? campHtml : "");
    // The pinned footer (ui-shell.mjs): Undo when there is a route change to undo, editing, then More.
    const editable = gm && !inCamp && pr?.status !== "arrived" && !this.mode;
    const foot = gm ? `<footer class="kgr-sh-foot">${this.history?.length ? `<button data-act="undo" title="Undo the last route change (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i> Undo route change</button>` : ""}${editable ? `<button data-act="edit"><i class="fa-solid fa-route"></i> Edit route</button>${r ? `<button data-act="place-encounter"><i class="fa-solid fa-triangle-exclamation"></i> Add encounters</button>` : ""}` : ""}
      <span class="kgr-sh-sp"></span><button data-act="more" class="more ${this.moreOpen ? "on" : ""}" aria-expanded="${this.moreOpen ? "true" : "false"}">More <i class="fa-solid fa-caret-${this.moreOpen ? "up" : "down"}"></i></button>
      ${this.moreOpen ? `<div class="more-menu" role="menu"><button data-act="recalc" role="menuitem" ${this.stops().length > 1 ? "" : "disabled"} title="From the start through your stops to the end, along the roads"><i class="fa-solid fa-arrows-rotate"></i> Recalculate the route</button><button data-act="reset" role="menuitem" ${this.state.trip ? "" : "disabled"}><i class="fa-solid fa-backward-fast"></i> Back to the start</button><button data-act="clear" role="menuitem" class="danger"><i class="fa-solid fa-trash"></i> Clear the route</button></div>` : ""}</footer>` : "";
    const encRows = gm ? this.#encounterRows() : [];
    const activeTab = !gm && this.tab === "enc" ? "route" : this.tab;
    const tabs = `<nav class="kgr-tabs"><button data-tab="route" class="${activeTab === "route" ? "on" : ""}"><i class="fa-solid fa-route"></i> Route</button>${inCamp ? `<button data-tab="camp" class="${activeTab === "camp" ? "on" : ""}"><i class="fa-solid fa-campground"></i> Camp</button>` : ""}${gm ? `<button data-tab="enc" class="${activeTab === "enc" ? "on" : ""}"><i class="fa-solid fa-triangle-exclamation"></i> Encounters <small>${encRows.filter((x) => x.hour != null).length}</small></button>` : ""}<button data-tab="rules" class="${activeTab === "rules" ? "on" : ""}"><i class="fa-solid fa-book"></i> Rules</button></nav>`;
    const offRoute = encRows.filter((x) => x.hour == null).length;
    const warn = offRoute ? `<p class="warn" data-tab="enc"><i class="fa-solid fa-circle-exclamation"></i> ${offRoute} encounter${offRoute === 1 ? " is" : "s are"} off the route and will not be met. See Encounters.</p>` : "";
    const encounter = gm && pr?.status === "encounter" && pr.encounter?.kind !== "town" ? this.#encounterDetail(pr) : "";
    const topError = failedLeg < 0 ? failed : "";
    const main = activeTab === "camp" ? `${campHtml}${encounter}`
      : gm && activeTab === "enc" ? `${hint}${this.#encounterTab(encRows)}`
      : activeTab === "rules" ? this.#rulesTab()
      : `${hint}${stage === "sea" ? campHtml : ""}${encounter}${settings}${whereTo}${topError}${list}${addStop}${journey}${warn}`;
    // The redraw keeps the panel where it was scrolled to.
    const html = `${head}${tabs}<div class="body">${main}</div>${pinned}${foot}`;
    if (html !== this.panelHtml) { renderPanel(this.el, html); this.panelHtml = html; }
    this.camp.decorate(this.el);
    if (this.mode) editBar.update(this, this.#barState());
    this.#place();
    restoreScroll(this.el, scroll);
  }
  /**
   * Encounters on this route in the order the party meets them (the journey's own and the map
   * editor's within reach of the path), then the journey's own that the route no longer passes.
   */
  #encounterRows() {
    const own = this.state.encounters ?? [], world = new Map(this.getEncounters().map((e) => [e.id, e]));
    const on = (this.plan?.encounters ?? []).filter((e) => e.kind !== "town").map((e) => ({ ...e, ...(own.find((o) => o.id === e.id) ?? world.get(e.id) ?? {}), hour: e.hour, own: own.some((o) => o.id === e.id) }));
    const seen = new Set(on.map((e) => e.id));
    const off = own.filter((e) => !seen.has(e.id)).map((e) => ({ ...e, own: true, hour: null, at: this.toSource(e.lon, e.lat) }));
    return [...on, ...off];
  }

  #encounterTab(rows) {
    if (!rows.length) return `<p class="hint">${this.result ? "No encounters on this route. Click Add encounters below, then click the route to place one." : "Plan a route first."}</p>`;
    const s = this.state, p = this.progress(), dayOf = (h) => this.#dayAt(h);
    const resumed = s.trip?.resumed ?? {};
    let n = 0;
    const row = (e) => {
      const state = e.hour == null ? "off" : p?.status === "encounter" && p.encounter?.id === e.id ? "now" : (resumed[e.id] != null || (p && e.hour < p.hour - 1e-6)) ? "done" : "";
      const meta = e.hour == null ? "off the route" : e.rest ? `in camp, night ${e.rest.night ?? "?"} · ${hrs(e.rest.at ?? 0)} into the rest` : `${mi(this.#milesAt(e.hour))} mi · day ${dayOf(e.hour)}`;
      return `<li class="enc-row ${state}" data-enc="${esc(e.id)}" data-own="${e.own ? 1 : ""}" title="Open its card">
        <span class="n">${e.hour == null ? '<i class="fa-solid fa-circle-exclamation"></i>' : ++n}</span>
        <span class="nm">${esc(e.name ?? "Encounter")}${e.own ? "" : ' <small title="Placed in the map editor">placed on the map</small>'}</span>
        <span class="meta">${meta}${e.dc != null ? ` · DC ${e.dc}` : ""}</span>
        <button data-act="goto" data-x="${e.at[0]}" data-y="${e.at[1]}" data-i="" title="Show on the map"><i class="fa-solid fa-location-crosshairs"></i></button>
        <button data-act="enc-edit" data-id="${esc(e.id)}" data-own="${e.own ? 1 : ""}" title="Edit"><i class="fa-solid fa-pen"></i></button></li>`;
    };
    const on = rows.filter((e) => e.hour != null), off = rows.filter((e) => e.hour == null);
    return `${on.length ? `<section class="tr-sec"><div class="tr-cap">On the route<span class="kgr-sh-sp"></span>${on.length}</div><ol class="encounters">${on.map(row).join("")}</ol></section>` : ""}${off.length ? `<section class="tr-sec"><div class="tr-cap">Off the route<span class="kgr-sh-sp"></span>Will not be met</div><ol class="encounters">${off.map(row).join("")}</ol></section>` : ""}<p class="hint">Click an encounter for its card. To place a new one, click Add encounters, then click the route.</p>`;
  }

  /** A length of time as days and hours ("2 d 9 h"), or hours under a day. */
  #span(h) {
    if (h < 24) return hrs(h);
    const d = Math.floor(h / 24), r = Math.round(h - d * 24);
    return r ? `${d} d ${r} h` : `${d} d`;
  }

  /** The Rules tab: the travel rules at a glance, in the world's edition (the switch sets it). */
  #rulesTab() {
    const R = this.ruleText(), y = R.rules;
    const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
    const sec = (title, body, tag = "") => `<section class="rules-sec"><h4>${title}${tag ? ` <span class="tag">${tag}</span>` : ""}</h4>${body}</section>`;
    return `<div class="rules-tab">
      <div class="row"><span class="grow">${game.user.isGM ? "Rules from" : `Rules: ${esc(y)} (set by the GM)`}</span>${game.user.isGM ? `<div class="seg">${["2014", "2024"].map((k) => `<button data-act="rules" data-value="${k}" class="${y === k ? "on" : ""}">${k}</button>`).join("")}</div>` : ""}</div>
      ${sec("Pace", `${["fast", "normal", "slow"].map((k) => ruleContent(R.pace[k])).join("")}`)}
      ${sec("Terrain", `${ruleContent(R.terrain)}`)}
      ${sec("Forced march", `${ruleContent(R.forced)}`)}
      ${sec("Resting", `${ruleContent(R.rest)}${ruleContent(R.sleep)}`)}
      ${sec("Keeping watch", `${ruleContent(R.watch)}${ruleContent(R.campRolls)}`)}
      ${sec("Advanced watches", `${ruleContent(R.tasks)}${ruleContent(R.forage)}${ruleContent(R.conceal)}${ruleContent(R.alarm)}${ruleContent(R.provision)}`, "Table rules")}
      ${sec("Travelling by", `${Object.entries(METHODS).map(([k, m]) => `<b>${esc(m.short)}</b>: ${ruleContent(R.methods[k])}`).join("")}`)}
      ${sec("By water", `${ruleContent(R.ways)}`)}
      ${sec("Vessels", `<table class="rules-table"><tr><th>Vessel</th><th>mph</th><th>A day</th></tr>${Object.values(VESSELS).map((v) => row([esc(v.label), v.mph, `${mi(v.mph * (v.crewed ? 24 : 8))} mi${v.crewed ? "" : " (8 h)"}`])).join("")}</table>${ruleContent(R.sail)}`)}
      ${sec("Waterways", `${ruleContent(R.water)}`, "Table rule")}
      ${sec("Seasons at sea", `${ruleContent(R.seasons)}`, "Lore")}
      ${sec("Fares", `${ruleContent(R.fares)}${this.priceScale !== 1 ? ` This world's prices: ${this.priceScale > 1 ? `×${this.priceScale}` : `÷${Math.round(1 / this.priceScale)}`} (the Prices setting).` : ""}`)}
    </div>`;
  }

  /**
   * What now, pinned under the plan: any decision first (with its own buttons), then the day, the
   * distance and a progress bar with the stops on it, where the party is, then (GM) the buttons.
   * Players see the same without the buttons or encounter names.
   */
  #pinned(decision = "") {
    const s = this.state, p = this.progress(), r = this.result, gm = game.user.isGM, sts = this.stops(), progressOnly = !gm && s.show === "progress";
    const pin = (body) => (body ? `<section class="tr-pin">${body}</section>` : "");
    const pos = (title, sub = "", pill = "", cls = "") => `<div class="tr-pos"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}<span class="kgr-sh-sp"></span>${pill ? `<span class="pill ${cls}">${esc(pill)}</span>` : ""}</div>`;
    const biome = this.currentBiome()?.name ?? "";
    const days = r ? this.#dayAt(r.hours) : 0;
    if (gm && this.mode === "route") return pin(`${pos("Editing", r ? `${mi(r.miles)} mi, ${days} day${days === 1 ? "" : "s"}` : "")}<button type="button" data-act="edit" class="primary">Finish route</button>`);
    if (gm && this.mode === "encounter") return pin(`${pos("Adding encounters")}<button type="button" data-act="place-encounter" class="primary">Finish adding</button>`);
    if (sts.length < 2) return gm ? pin(`${pos("Choose where to go", esc(biome))}<p class="tell">Start travel appears once there is a route.</p>`) : "";
    if (!r) {
      const leg = this.noRouteWhy?.leg;
      return gm ? pin(`${pos("No route", "", this.noRoute && leg != null ? `Fix leg ${leg + 1}` : "", "alert")}<p class="tell">Start travel appears once every leg has a way.</p>`) : "";
    }
    if (!p) {
      if (!gm) return "";
      return pin(`${pos("Not started", esc(biome))}<p class="tell">Start travel, then move time on (here or with the calendar) and the party travels with it.</p><button type="button" data-act="start" class="primary"><i class="fa-solid fa-play"></i> Start travel</button>`);
    }
    const done = this.#milesAt(p.hour), pct = Math.max(0, Math.min(100, (done / Math.max(1e-9, r.miles)) * 100));
    const ticks = progressOnly ? "" : (this.sheet?.nodes ?? []).filter((n) => n.stop > 0 && n.miles < r.miles - 1e-6).map((n) => `<i style="left:${((n.miles / r.miles) * 100).toFixed(1)}%"></i>`).join("");
    const town = p.status === "encounter" && p.encounter?.kind === "town";
    // Players never learn an encounter's name, or that one is waiting: to them the party has stopped.
    const pill = { moving: [p.sailing ? "Sailing" : "On the road", ""], halted: [p.away ? "Paused: away" : "Paused", ""], resting: [this.camp.phaseStatus(p)?.label ?? "Camped", ""], stay: ["Staying", ""], decide: [gm ? "Waiting for you" : "End of the day", "amber"], arrived: ["Arrived", "ok"] }[p.status]
      ?? (town ? [gm ? "Waiting for you" : `Reached ${p.encounter.name}`, "amber"] : gm ? [p.camp ? "Encounter in camp" : "Encounter", "alert"] : ["Stopped", ""]);
    const where = this.#near(this.#at(p.hour)), left = p.until ? this.#span(Math.max(0, p.until - this.clock) / 3600) : "";
    const next = progressOnly ? null : (this.sheet?.nodes ?? []).find((n) => n.stop > 0 && n.hour > p.hour + 1e-6);
    let line = `${where[0].toUpperCase()}${where.slice(1)}.`;
    if (p.status === "moving") line += p.sailing ? " Aboard ship, sailing day and night." : ` ${hrs(p.dayHours ?? 0)} of ${s.hours} h on the road today.`;
    if (p.status === "halted" && !p.away) line += " Time passes, but the party stays put.";
    if (left && ["resting", "stay"].includes(p.status)) line += ` ${left} more.`;
    if (next && p.status !== "arrived") line += ` Next: <b>${esc(next.name)}</b>, day ${this.#dayAt(next.hour)}.`;
    const position = `${pos(`Day ${this.#dayAt(p.hour)}${progressOnly ? "" : ` of ${days}`}`, progressOnly ? `${mi(done)} mi` : `${mi(done)} of ${mi(r.miles)} mi`, pill[0], pill[1])}<div class="now-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Journey progress"><span style="width:${pct.toFixed(1)}%"></span>${ticks}</div>`;
    const inCamp = p.status === "resting" || (p.status === "encounter" && p.camp);
    const whereLine = inCamp || p.status === "decide" ? "" : `<p class="now-line">${line}</p>`;
    if (!gm) return pin(`${decision}${position}${whereLine}`);
    // A decision comes first, and holds its own buttons.
    if (decision) return pin(`<div class="tr-ask">${decision}</div>${position}`);
    if (town) return pin(`<div class="tr-ask"><b>Reached ${esc(p.encounter.name)}</b><small>This town has a map. The party can stop and go in, or carry on through.</small><div class="tr-pair"><button type="button" data-act="town-stay" class="primary"><i class="fa-solid fa-door-open"></i> Stop in ${esc(p.encounter.name)}</button><button type="button" data-act="town-pass"><i class="fa-solid fa-play"></i> Carry on</button></div></div>${position}`);
    if (p.status === "encounter") return pin(`<div class="tr-ask alert"><b>${esc(p.encounter?.name ?? "Encounter")}</b><small>${p.camp ? "The night waits until you conclude it, then the rest carries on." : "The party has stopped. The journey waits until you conclude it."}</small><button type="button" data-act="carry-on" class="primary"><i class="fa-solid fa-play"></i> Conclude Encounter</button></div>${position}${whereLine}`);
    if (p.status === "arrived") {
      const end = this.plan?.encounters.find((e) => e.kind === "town" && e.sceneId && e.hour >= r.hours - 1e-3), scene = end && game.scenes.get(end.sceneId);
      return pin(`${position}${whereLine}<div class="tr-pair">${scene ? `<button type="button" data-act="arrive-enter" class="primary"><i class="fa-solid fa-door-open"></i> Enter ${esc(end.name)}</button>` : ""}<button type="button" data-act="clear">New journey</button></div>`);
    }
    if (p.status === "halted") {
      const escape = s.trip?.escape;
      return pin(`${position}${escape ? `<p class="now-line">Camp was abandoned without rest or packing. The party fled ${mi(escape.distance)} miles. The GM decides what was left behind.</p>` : whereLine}<button type="button" data-act="start" class="primary"><i class="fa-solid fa-play"></i> ${escape ? `Rejoin route (${mi(escape.distance)} mi)` : "Resume travel"}</button>${s.trip?.townStop && s.trip.townStop.from === p.since ? `<button type="button" data-act="town-enter"><i class="fa-solid fa-door-open"></i> Enter ${esc(s.trip.townStop.name)}: ${s.trip.townStop.arrival === "sea" ? "dock arrival" : "choose entrance"}</button>` : ""}`);
    }
    if (p.status === "resting") return pin(position);
    const moving = p.status === "moving" || p.status === "stay";
    const tell = !moving ? "" : p.status === "stay" ? `<p class="tell">The party sets off again when the stay ends, as time moves on.</p>` : `<p class="tell">The ${p.sailing ? "ship sails" : "party moves"} as time moves on: use the buttons below, or the calendar.</p>`;
    return pin(`${position}${whereLine}${tell}${this.#controls(p)}`);
  }

  /** The encounter the party has met: who notices it, and its card and pictures. */
  #encounterDetail(p) {
    const s = this.state, e = p.encounter, R = this.ruleText(), who = e?.dc != null ? perceptionAgainst(this.party(), e.dc, s.pace) : [];
    if (!e) return "";
    const names = (list) => list.map((c) => `${esc(c.name)} ${c.adjusted}`).join(", ") || "none";
    return `<section class="tr-sec"><div class="tr-cap">The encounter ${rule(R.notice)}</div>
      <div class="tr-sum"><span>Wisdom (Perception)</span><b>${e.dc != null ? `DC ${e.dc}` : "No DC"}</b>${who.length ? `<span>Notices</span><b>${names(who.filter((c) => c.notices))}</b><span>Misses</span><b>${names(who.filter((c) => !c.notices))}</b>` : ""}${e.notes ? `<span>Notes</span><b>${esc(e.notes)}</b>` : ""}</div>
      ${p.camp ? "" : e.dc != null && e.perception !== "passive" ? `<button data-act="ask-rolls" class="wide" title="The party was asked when the encounter began; ask again"><i class="fa-solid fa-dice-d20"></i> Ask for Perception rolls again</button>` : e.dc != null ? `<small class="sub">Passive Perception only: no rolls asked.</small>` : ""}
      ${assetStrip({ actors: e.actors ?? (e.actor ? [e.actor] : []), images: e.images ?? [] })}
      <div class="tr-pair"><button data-act="enc-card" data-id="${esc(e.id)}" data-own="${(s.encounters ?? []).some((o) => o.id === e.id) ? 1 : ""}"><i class="fa-solid fa-id-card"></i> Open card</button>${e.pinned ? `<button data-act="enc-journal" data-uuid="${esc(e.pinned)}" title="Its pinned journal"><i class="fa-solid fa-book-open"></i> Journal</button>` : ""}</div></section>`;
  }

  /** The GM's controls while the party is on its way: the two skips, then pause. */
  #controls(p) {
    const st = p?.status, ahead = p && this.plan?.encounters.some((e) => !e.rest && e.hour > p.hour + 1e-6);
    const blocked = !p || ["decide", "encounter", "arrived", "resting"].includes(st);
    const atSea = !!p?.sailing;
    return `<div class="tr-pair">
      <button type="button" data-act="skip-encounter" title="Move time on to the next encounter, making camp each night" ${blocked || !ahead ? "disabled" : ""}><i class="fa-solid fa-forward"></i> Skip to next encounter</button>
      <button type="button" data-act="skip-rest" title="Advance to the next camp decision, stopping at encounters on the way. Camp setup and sleep have not begun" ${blocked || atSea ? "disabled" : ""}><i class="fa-solid fa-campground"></i> Skip to next camp</button></div>
      ${atSea ? `<small class="sub">No camp while the crew sails on. The party rests aboard.</small>` : ""}
      <button type="button" data-act="stop"><i class="fa-solid fa-pause"></i> Pause travel</button>`;
  }

  #near(at) {
    if (!at) return "";
    let best = null, bd = Infinity;
    for (const p of this.getPlaces()) {
      if (p.hidden || p.kind === "natural" || p.kind === "territory" || p.kind === "domain") continue;
      const q = this.toSource(p.lon, p.lat), d = Math.hypot(q[0] - at[0], q[1] - at[1]);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return "in the wilds";
    const m = bd * this.sourceMap.milesPerPixel;
    return m < 1.5 ? `at ${best.name}` : `${mi(m)} mi from ${best.name}`;
  }

  /** The party's characters: the Party Token's group members, else the travelling tokens' actors, else the players' characters. */
  members() {return [...new Map(this.partyTokens().flatMap(t=>groupMembers(t.actor)).map(a=>[a.id,a])).values()];}

  /**
   * Harvesting (0.96): the party stays where it is for `seconds` from now, a halt on its journey, so
   * the clock moving on doesn't carry it along. Only while it is on the move (waiting at an encounter,
   * resting or halted, it stays put already). Returns whether a halt was added.
   */
  async holdFor(seconds, why = "harvest") {
    const s = this.state;
    if (!s?.trip || !(seconds > 0) || this.progress()?.status !== "moving") return false;
    const now = game.time.worldTime;
    await this.save({ trip: { ...s.trip, halts: [...(s.trip.halts ?? []), { from: now, to: now + seconds, why }] } });
    return true;
  }

  /** Characters for Perception. */
  party() { return this.members().map((a) => ({ name: a.name, passive: Number(a.system?.skills?.prc?.passive ?? 10) })); }

  /** The slowest walking speed in the party: { feet, who, burden (the slowest's, else ""), burdened: [{ name, burden }] }. */
  speed() {
    let best = null;
    const burdened = [];
    for (const a of this.members()) {
      const ft = Number(a.system?.attributes?.movement?.walk), burden = burdenOf(a);
      if (burden) burdened.push({ name: a.name, burden });
      if (Number.isFinite(ft) && ft > 0 && (!best || ft < best.feet)) best = { feet: ft, who: a.name, burden };
    }
    return { ...(best ?? { feet: 30, who: null, burden: "" }), burdened };
  }

  favoredTerrains() { return partyFavoredBiomes(this.members(), biomeTypes(this.getBiomes?.() ?? {})); }

  /* ------------------------------------------------------------------ actions */

  async #click(e) {
    const focus=e.target.closest('[data-party-focus]')?.dataset.partyFocus;if(focus)return this.onPartyFocus?.(focus);
    // The camp panel's own buttons (players use some of them too).
    const campBtn = e.target.closest("button[data-camp]");
    if (campBtn) return this.camp.click(campBtn);
    if (e.target.closest(".stop-grip")) return;
    const btn = e.target.closest("[data-act], [data-set], [data-tab]");
    // A click on an encounter row (not its buttons): its card.
    const row = !btn && e.target.closest("[data-enc]");
    if (row) return this.showEncounterCard(row.dataset.enc, !!row.dataset.own);
    if (!btn) return;
    const act = btn.dataset.act, i = Number(btn.dataset.i);
    if (btn.dataset.tab) { if (!game.user.isGM && btn.dataset.tab === "enc") return; this.tab = btn.dataset.tab; return this.render(); }
    if (act === "collapse") return this.toggle();
    if (act === "setup") { this.setupOpen = !this.setupOpen; return this.render(); }
    if (act === "leg-fold") { const g = Number(btn.dataset.g); this.openLegs ??= new Set(); this.openLegs.has(g) ? this.openLegs.delete(g) : this.openLegs.add(g); return this.render(); }
    if (act === "leg-places") { const g = Number(btn.dataset.g); this.openPlaces ??= new Set(); this.openPlaces.has(g) ? this.openPlaces.delete(g) : this.openPlaces.add(g); return this.render(); }
    if (act === "journey-fold") { this.journeyOpen = !this.journeyOpen; return this.render(); }
    if (act === "more") { this.moreOpen = !this.moreOpen; return this.render(); }
    if (act === "reset" || act === "clear") this.moreOpen = false;
    if (act === "enc-card") return this.showEncounterCard(btn.dataset.id, !!btn.dataset.own);
    // The encounter's assets in the encounter box: its journal, an actor, a picture.
    if (act === "enc-journal") return openPinned(btn.dataset.uuid);
    if (act === "actor-n" || act === "pic") {
      const e = this.progress()?.encounter;
      if (!e) return;
      if (act === "pic") return new foundry.applications.apps.ImagePopout({ src: e.images?.[i], window: { title: e.name } }).render(true);
      return openDoc((e.actors ?? (e.actor ? [e.actor] : []))[i]);
    }
    if (act === "lock") { await this.#set("travelHudLocked", !this.locked); return this.render(); }
    if (act === "undo") return this.undo();
    if(act==="regional-view")return this.openRegionalView?.(btn.dataset.world||null);
    if (act === "goto") { const [lon, lat] = this.toLonLat(Number(btn.dataset.x), Number(btn.dataset.y)), c = latLonToScene(this.getLayer().frame, lat, lon); canvas.animatePan({ x: c.x, y: c.y, duration: 400 }); if (btn.dataset.i !== "") { this.selected = i; this.draw(); this.render(); } return; }
    if (!game.user.isGM) return;
    if (!this.leader) return ui.notifications.info(`KG Realms: ${primaryGM()?.name ?? "the primary GM"} controls the journey.`);
    const s = this.state, now = this.clock;
    if(act==="find-destination"){
      const places=(this.getDestinations?.()??[]).filter(p=>!p.hidden&&!['territory','domain'].includes(p.kind)&&!['Road','Trail'].includes(p.class)).sort((a,b)=>a.name.localeCompare(b.name));
      if(!places.length)return ui.notifications.info("No destinations on the linked maps yet.");
      const targetScene=this.scene,targetTrip=journeyKey(this.state);
      const picked=await RealmDialog.wait({window:{title:"Travel destination"},rejectClose:false,content:`<div class="form-group"><label>Find a place</label><input name="filter" type="search" placeholder="Type a name"></div><div class="form-group"><label>Destination</label><select name="place" size="10">${places.map((p,i)=>`<option value="${i}">${esc(p.name)}${p.regionalTitle?` (${esc(p.regionalTitle)})`:''}</option>`).join('')}</select></div>`,render:(_e,d)=>{const el=d.element;el.querySelector('input').oninput=e=>{const options=[...el.querySelectorAll('option')];options.forEach(o=>o.hidden=!o.textContent.toLowerCase().includes(e.target.value.toLowerCase()));const first=options.find(o=>!o.hidden);if(first)el.querySelector('select').value=first.value;const add=el.querySelector('[data-action=add]');if(add)add.disabled=!first;};},buttons:[{action:'add',label:'Add destination',callback:(_e,b)=>b.form.elements.place.value},{action:'cancel',label:'Cancel',callback:()=>null}]});
      if(picked==null||picked===false||picked===''||this.scene!==targetScene||journeyKey(this.state)!==targetTrip)return;const place=places[Number(picked)];if(!place)return;
      return this.save({waypoints:[...this.state.waypoints,{lon:place.lon,lat:place.lat,name:place.name,stop:true}]},{scene:targetScene,expectedTrip:targetTrip});
    }
    if (btn.dataset.set) return this.save({ [btn.dataset.set]: btn.dataset.value });
    if (act === "edit") { this.addingStop = false; this.#setMode(this.mode === "route" ? null : "route"); return this.render(); }
    // Add stop: map clicks add stops while editing; the search box is there too.
    if (act === "add-stop") { this.addingStop = !this.addingStop; this.#setMode(this.addingStop ? "route" : null); return this.render(); }
    if (act === "bypass") return this.#bypass(i);
    if (act === "arrive-enter") {
      const end = this.plan?.encounters.find((x) => x.kind === "town" && x.sceneId && x.hour >= (this.result?.hours ?? 0) - 1e-3), scene = end && game.scenes.get(end.sceneId), arrival = settlementArrivalMode(this.result, this.progress()?.hour);
      const gate = scene ? await chooseSettlementGate(scene, { arrival }) : null;
      return gate ? this.enterTown(scene, gate, () => this.leader, arrival) : undefined;
    }
    if (act === "stop-here") return this.#stopHere(i, Number(btn.dataset.b));
    if (act === "leg-way") {
      const v = btn.dataset.value;
      if (v === "land") return this.save({ legModes: this.#legSet("legModes", i, "road"), legWays: this.#legSet("legWays", i, null) });
      return this.save({ legModes: this.#legSet("legModes", i, "sea"), legWays: this.#legSet("legWays", i, v), legVessels: this.#legSet("legVessels", i, s.legVessels?.[i] ?? (v === "river" ? "keelboat" : "sailing")) });
    }
    if (act === "river-take") return this.#takeRiver(i);
    if (act === "river-skip") { const o = this.riverOffers?.find((x) => x.leg === i); return o && this.save({ shipSkip: [...(s.shipSkip ?? []), `river|${i}|${o.river.name ?? ""}`] }); }
    if (act === "place-encounter") { this.#setMode(this.mode === "encounter" ? null : "encounter"); return this.render(); }
    if (act === "del") return this.#removeStop(i);
    if (act === "recalc") {
      // A clean route: the start, the numbered stops (with their stays) and the end, worked out afresh
      // along the roads. Path shaping points and Direct legs are dropped.
      this.moreOpen = false;
      const nums = this.#numbers(), keep = s.waypoints.map((w, k) => k).filter((k) => nums[k] != null);
      const dropped = s.waypoints.length - keep.length, direct = (s.legModes ?? []).filter((m) => m === "direct").length;
      if (dropped || direct) {
        const ok = await RealmDialog.confirm({
          window: { title: "Recalculate route" },
          content: `<p>Work the route out afresh from the start through your ${keep.length} stop${keep.length === 1 ? "" : "s"}, along the roads?</p><p>${[dropped ? `${dropped} path shaping point${dropped === 1 ? "" : "s"}` : "", direct ? `${direct} Direct leg${direct === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} will be dropped. Stops, stays and encounters stay.</p>`,
          rejectClose: false
        });
        if (!ok) return this.render();
      }
      this.selected = null;
      // Sea legs stay at sea; methods, ships and haggled fares stay with their stops.
      const kept = (key) => keep.map((k) => s[key]?.[k] ?? null);
      return this.save({ waypoints: keep.map((k) => s.waypoints[k]), stays: keep.map((k) => s.stays[k] ?? 0), legModes: keep.map((k) => (s.legModes?.[k] === "sea" ? "sea" : null)), legMethods: kept("legMethods"), legVessels: kept("legVessels"), legFares: kept("legFares"), legWays: kept("legWays") });
    }
    if (act === "rules") return this.#set("travelRules", btn.dataset.value);
    if (act === "ship-take") { const h = this.shipHints?.[i], o = h?.options[Number(btn.dataset.o)]; return o && this.takeShip(h, o); }
    if (act === "ship-skip") { const h = this.shipHints?.[i]; return h && this.save({ shipSkip: [...(s.shipSkip ?? []), ...h.options.map((o) => `${h.a.p.id}|${o.b.p.id}`)] }); }
    if (act === "fare-reset") { const legFares = [...(s.legFares ?? [])]; legFares[i] = null; return this.save({ legFares }, { undoable: false }); }
    if (act === "ask-rolls") { const p = this.progress(); if (p?.status === "encounter" && p.encounter) return this.requestPerception(p.encounter); return; }
    if (act === "enc-edit") return this.showEncounterCard(btn.dataset.id, !!btn.dataset.own, { edit: true });
    if (act === "way") {
      const legModes = [...(s.legModes ?? [])];
      legModes[i] = legModes[i] === "direct" ? null : "direct";
      return this.save({ legModes });
    }
    if (act === "clear") {
      const ok = await RealmDialog.confirm({ window: { title: "Clear route" }, content: "<p>Clear this route, its encounters and its progress?</p>", rejectClose: false });
      if (!ok) return;
      this.#setMode(null);
      this.selected = null;
      if (s.trip && s.now?.status !== "arrived") await this.#log("The route is cleared; the journey ends here.", { close: true, at: now });
      await this.save({ waypoints: [], ...Object.fromEntries(LEG_KEYS.map((k) => [k, []])), encounters: [], name: "", start: null, trip: null, now: null, shipSkip: [] });
      return;
    }
    if (act === "start") {
      if(!this.partyTokens().length)return ui.notifications.warn("KG Realms: place or designate a group actor party token before starting travel.");
      if (!s.trip) {
        // A new trip's nights count from 1 again: the last trip's camps (made, their checks, the
        // watcher's check, the camp scene) go; the party's watch order, hours, tasks and scenes stay.
        const w = s.watch ?? {};
        await this.save({ start: this.#partyStop(), trip: { departed: now, decisions: [], resumed: {}, halts: [], walking: { ...walkingHistory(null, this.speed().feet), favored: this.favoredTerrains() }, biomeTravel:freezeBiomeTravel(this.getBiomes?.()??{}), ...(this.regionalSnapshot?{regionalPlan:structuredClone(this.regionalSnapshot)}:{}) }, now: null, watch: { ...w, setup: null, campId: null, checks: null, asks: {}, scene: null, encWatch: {} } });
        return this.#log(null);
      }
      if (s.trip.escape) await this.advanceClock(s.trip.escape.returnSeconds ?? 0);
      const resumedAt = this.clock, halts = (this.state.trip.halts ?? []).map((h) => (h.to == null ? { ...h, to: resumedAt } : h));
      this.motionDuration = 8000;
      try { await this.save({ trip: { ...this.state.trip, escape: null, townStop: null, halts } }); await this.tick({ force: true }); }
      finally { this.motionDuration = null; }
      return this.#log(`Travel resumed ${this.#near(this.#at(this.progress()?.hour ?? 0))}.`, { at: resumedAt });
    }
    if (act === "stop") return this.save({ trip: { ...s.trip, halts: [...(s.trip.halts ?? []), { from: now, to: null }] } });
    if (act === "reset") {
      const ok = await RealmDialog.confirm({ window: { title: "Back to the start" }, content: "<p>Put the party back at the start? Game time is not changed.</p>", rejectClose: false });
      if (!ok) return;
      const start = s.start;
      await this.#log("The journey is called off; the party goes back to the start.", { close: true, at: now });
      await this.save({ trip: null, start: null, now: null });
      if (start) await this.#moveTo(this.toSource(start.lon, start.lat));
      return;
    }
    if (act === "town-stay" || act === "town-pass") return this.#townChoice(act === "town-stay");
    if (act === 'town-enter') return this.#enterStoppedTown();
    if (act === "camp") {
      // The camp's encounters take their hour from the watch set for them (or wait on the watch
      // dice), the rest begins, and the camp scene comes up for everyone.
      const p = this.progress();
      if (p?.status !== "decide") return;
      await this.camp.settleEncounters(p.night);
      await this.#decide({ rest: this.camp.plan().rest });
      return this.camp.openScene(p.night);
    }
    if (act === "push") {
      if (!this.leader || this.pushing) return;
      const p = this.progress();
      if (p?.status !== "decide") return;
      this.pushing = true;
      try {
        await this.#decide({ push: true });
        // A push is one travel hour. Stop the clock at an encounter or the route's end if either
        // happens first, rather than moving past it before the GM can resolve it.
        const next = this.progress(Infinity);
        const dt = pushedHourAdvance(this.clock, p.since, next);
        if (dt > 0) await this.advanceClock(dt);
      } finally { this.pushing = false; }
      return;
    }
    if (act === "carry-on") {
      const p = this.progress();
      if (p?.status !== "encounter") return;
      if (p.camp) return this.camp.click({ dataset: { camp: "scene-carry" } });
      return this.save({ trip: { ...s.trip, resumed: { ...(s.trip.resumed ?? {}), [p.encounter.id]: now } } });
    }
    if (act === "skip-rest" || act === "skip-encounter") {
      if (this.state.trip?.escape) return ui.notifications.info("KG Realms: rejoin the route before fast-forwarding, or plan a new journey from the party's position.");
      if (this.progress()?.status === "resting" || this.progress()?.camp) return;
      const enc = act === "skip-encounter";
      // Stopped: set off again first, from now.
      if (this.progress()?.status === "halted") await this.save({ trip: { ...s.trip, halts: (s.trip.halts ?? []).map((h) => (h.to == null ? { ...h, to: now } : h)) } });
      // Camp encounters are left to the camp scene's watches: Next encounter goes to the next on the road.
      const p = this.progress(Infinity, enc ? { autoRest: s.rest, skipCamp: true } : {});
      if (!p) return;
      if (p.made?.length) {
        const t = this.state.trip;
        await this.save({ trip: { ...t, decisions: [...(t.decisions ?? []), ...p.made] } });
        ChatMessage.create({ content: `<p><i class="fa-solid fa-campground"></i> The party makes camp ${p.made.length === 1 ? "one night" : `${p.made.length} nights`} on the way.</p>`, speaker: { alias: s.name || "Journey" } });
        this.#log(`Time moves on: the party makes camp ${p.made.length === 1 ? "one night" : `${p.made.length} nights`} on the way.`, { at: now });
      }
      const dt = p.since - now;
      if (dt > 0) await this.advanceClock(Math.ceil(dt));
    }
  }

  async #drop(e) {
    const zone = e.target.closest?.(".ship-drop");
    if (!zone || !game.user.isGM) return;
    e.preventDefault();
    zone.classList.remove("over");
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    const actor = data?.type === "Actor" && data.uuid ? await fromUuid(data.uuid) : null;
    if (!actor) return ui.notifications.warn("KG Realms: drop an actor (a ship) here.");
    const v = TravelHud.vehicleVessel(actor);
    if (!v) return ui.notifications.warn(`KG Realms: ${actor.name} is not a water vehicle, so it cannot sail this leg.`);
    const i = Number(zone.dataset.leg), s = this.state, legVessels = [...(s.legVessels ?? [])];
    while (legVessels.length <= i) legVessels.push(null);
    legVessels[i] = v.key;
    await this.save({ legVessels });
    ui.notifications.info(`KG Realms: sailing on ${actor.name}, ${mi(v.mph)} mph.`);
  }

  async #change(e) {
    const t = e.target;
    if (t.dataset?.camp) return this.camp.change(t);
    if (!this.leader || !t.name) return;
    if (t.name.startsWith("stay-")) {
      const stays = [...this.state.stays];
      stays[Number(t.name.slice(5))] = Math.max(0, Number(t.value) || 0);
      return this.save({ stays });
    }
    if (t.name === "rest") return this.save({ rest: Math.max(16, Math.min(72, Number(t.value) || 16)) });
    const s = this.state;
    if (t.name === "coachMph") return this.save({ coachMph: Math.max(1, Math.min(30, Number(t.value) || METHODS.coach.roadMph)) });
    if (t.name === "methodMph") return this.save({ methodMph: Math.max(0.5, Math.min(30, Number(t.value) || 8)) });
    if (t.name.startsWith("term-")) {
      // A new deal: prices set by hand on those legs were for the old one.
      const k = t.name.slice(5), legFares = (s.legFares ?? []).map((v, i) => (!s.legModes?.[i] && (s.legMethods?.[i] ?? s.method) === k ? null : v));
      return this.save({ terms: { ...RIDE_DEALS.terms, ...s.terms, [k]: t.value }, legFares });
    }
    if (t.name.startsWith("rate-")) {
      const k = t.name.slice(5), key = { ...RIDE_DEALS.terms, ...s.terms }[k] === "paid" ? "pays" : "fares", value = Math.max(0, Number(t.value) || 0);
      return this.save({ [key]: { ...(key === "fares" ? DEFAULT.fares : RIDE_DEALS.pays), ...(s[key] ?? {}), [k]: value } });
    }
    if (t.name === "fare-ship") return this.save({ fares: { ...DEFAULT.fares, ...(s.fares ?? {}), [t.name.slice(5)]: Math.max(0, Number(t.value) || 0) } });
    // A leg's price, haggled: kept until reset, whenever it is changed (before or during the journey).
    if (t.name.startsWith("fare-")) {
      const i = Number(t.name.slice(5)), legFares = [...(s.legFares ?? [])], v = t.value === "" ? null : Math.max(0, Number(t.value) || 0);
      legFares[i] = v;
      return this.save({ legFares }, { undoable: false });
    }
    // Search by name: the end of the journey, or a stop on the way.
    if (t.name === "where" || t.name === "add-place") {
      const name = t.value.trim().toLowerCase(), p = name ? this.getPlaces().find((q) => !q.hidden && q.name?.toLowerCase() === name) : null;
      t.value = "";
      if (!name) return;
      if (!p) return ui.notifications.warn(`KG Realms: no place called ${name}.`);
      const spot = { lon: p.lon, lat: p.lat, name: p.name };
      if (t.name === "add-place") return this.#insertStop(spot);
      this.selected = 0;
      return this.save({ waypoints: [spot] });
    }
    // How a leg goes by land, and which boat.
    if (t.name.startsWith("how-")) {
      const i = Number(t.name.slice(4));
      return this.save({ legMethods: this.#legSet("legMethods", i, t.value.startsWith("m:") ? t.value.slice(2) : null) });
    }
    if (t.name.startsWith("ship-")) return this.save({ legVessels: this.#legSet("legVessels", Number(t.name.slice(5)), t.value) });
    const v = t.type === "number" ? Math.max(1, Math.min(16, Number(t.value) || 8)) : t.value;
    await this.save({ [t.name]: v });
  }

  /** The tokens that travel: a token named "Party Token" if there is one, else every player-owned token. */
  partyTokens(scene = this.scene) {
    const grid = scene?.grid?.size ?? 100;
    const all = scene === canvas.scene ? (canvas.tokens?.placeables ?? []) : Array.from(scene?.tokens ?? []).map((doc) => ({ id: doc.id, document: doc, actor: doc.actor, w: doc.width * grid, h: doc.height * grid, center: { x: doc.x + doc.width * grid / 2, y: doc.y + doc.height * grid / 2 } }));
    return selectPartyTokens(scene, all, this.#get("partyActor"));
  }

  /** The party's position as a stop, or null. */
  #partyStop() {
    const t = this.partyTokens()[0], layer = this.getLayer();
    if (!t || !layer?.frame) return null;
    const d=t.document,g=this.scene?.grid?.size??100;
    const center=Number.isFinite(d?.x)&&Number.isFinite(d?.y)?{x:d.x+(d.width??1)*g/2,y:d.y+(d.height??1)*g/2}:t.center;
    const { lon, lat } = sceneToLatLon(this.getTokenFrame?.(this.scene)??layer.frame, center);
    return { lon, lat, name: this.placeName(lon, lat) };
  }

  /** A stop's short name, for a journey's title: a stop named from where it stands reads as the place, not the whole line. */
  stopTitle(w, fallback) {
    if (!w?.name) return fallback;
    if (!/^(In|On|Near|near)\s/.test(w.name) || !Number.isFinite(w.lon)) return w.name;
    const here = this.toSource(w.lon, w.lat), mpp = this.sourceMap.milesPerPixel;
    return spotTitle(w.lon, w.lat, this.getPlaces(), (p) => { const q = this.toSource(p.lon, p.lat); return Math.hypot(q[0] - here[0], q[1] - here[1]) * mpp; });
  }

  /** What to call a spot (map-layers.mjs): its realm, its geography, and what it is near. */
  placeName(lon, lat) {
    const here = this.toSource(lon, lat), mpp = this.sourceMap.milesPerPixel;
    return spotName(lon, lat, this.getPlaces(), (p) => { const q = this.toSource(p.lon, p.lat); return Math.hypot(q[0] - here[0], q[1] - here[1]) * mpp; });
  }

  /** Move the party's tokens, keeping their spread, to a sheet point. Skips moves under a few pixels. */
  async #moveTo(at, { scene = this.scene, duration = 800 } = {}) {
    const frame = this.getTokenFrame?.(scene)??this.getLayer()?.frame;
    if (!frame || !at) return;
    try{await this.onTravelPosition?.(scene,at,this.partyTokens(scene).map(t=>t.document.id));this.regionalPositionError=null;}catch(error){console.warn("kg-realms | regional token mirror:",error);if(this.regionalPositionError!==error.message)ui.notifications.warn(`KG Realms: regional token could not be updated: ${error.message}`);this.regionalPositionError=error.message;}
    const tokens = this.partyTokens(scene).map((t) => {
      const doc = t.document, grid = scene.grid.size;
      // Token's id/w/h are prototype getters, so spreading the placeable loses them.
      return { id: doc.id, w: doc.width * grid, h: doc.height * grid, center: { x: doc.x + doc.width * grid / 2, y: doc.y + doc.height * grid / 2 } };
    });
    if (!tokens.length) return;
    const [lon, lat] = this.toLonLat(at[0], at[1]), c = latLonToScene(frame, lat, lon);
    const cx = tokens.reduce((s, t) => s + t.center.x, 0) / tokens.length, cy = tokens.reduce((s, t) => s + t.center.y, 0) / tokens.length;
    if (Math.hypot(c.x - cx, c.y - cy) < 2) return;
    const g = scene.grid.size;
    const updates = tokens.map((t, i) => {
      let dx = t.center.x - cx, dy = t.center.y - cy;
      const d = Math.hypot(dx, dy), cap = g * 1.5;
      if (d > cap) { dx *= cap / d; dy *= cap / d; }
      else if (d < 1 && tokens.length > 1) { dx = Math.cos(i * 2.4) * g * 0.6; dy = Math.sin(i * 2.4) * g * 0.6; }
      return { _id: t.id, x: c.x + dx - t.w / 2, y: c.y + dy - t.h / 2 };
    });
    await scene.updateEmbeddedDocuments("Token", updates, { animation: { duration, easing: null }, kgRealmsTravel: true });
  }

  /* ------------------------------------------------------------------ editing on the map */

  #setMode(mode) {
    if (mode && !game.user.isGM) return;
    const was = !!this.mode;
    this.mode = mode;
    if (mode !== "route") this.addingStop = false;
    this.drag = null;
    this.encDrag = null;
    if (mode) this.onEditStart?.();
    if (mode && !was) {
      this.offCanvas = onCanvas(this.handlers);
      this.onKey = (e) => this.#key(e);
      document.addEventListener("keydown", this.onKey, { capture: true });
    }
    if (!mode && was) {
      this.offCanvas?.(); this.offCanvas = null;
      document.removeEventListener("keydown", this.onKey, { capture: true });
      this.selected = null;
      this.draw();
      // Editing done: the players get the route now.
      if (this.draft) this.#publishDraft();
    }
    if (mode) editBar.show(this, this.#barState());
    else editBar.hide(this);
  }

  /** The editing bar while editing the route or adding encounters to it. */
  #barState() {
    const s = this.state, sts = this.stops(), route = this.mode === "route";
    const title = s.name || (sts.length > 1 ? `${this.stopTitle(sts[0], "Start")} to ${this.stopTitle(sts.at(-1), "End")}` : "New route");
    const sel = route && this.selected != null ? s.waypoints[this.selected] : null;
    return {
      title: route ? "Editing the route" : "Adding encounters", mode: title, undo: true,
      hint: route
        ? (sel ? `${sel.name ?? "Stop"} selected · drag it to move · Del removes it` : "Click the map to add a stop · click the route to add one there · drag a stop to move it")
        : "Click the route to place an encounter · drag one to move it · right-click removes it",
      esc: route ? "finishes the route" : "finishes adding",
      tip: route ? (sel ? "" : "Click to add a stop") : "Click the route to place one", crosshair: !sel,
      done: route ? "Finish route" : "Finish adding",
      onDone: () => { this.#setMode(null); this.render(); }
    };
  }

  /** Delete removes the selected stop; Ctrl+Z undoes a route edit; Esc finishes editing. Typing in a field is left alone. */
  #key(e) {
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.#setMode(null); return this.render(); }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ") { e.preventDefault(); e.stopImmediatePropagation(); return this.undo(); }
    if ((e.key === "Delete" || e.key === "Backspace") && this.mode === "route" && this.selected != null) {
      e.preventDefault(); e.stopImmediatePropagation();
      this.#removeStop(this.selected);
    }
  }

  /**
   * Stop i (a waypoint index) one stop earlier (-1) or later (1), not past a stop already reached.
   */
  #moveStop(i, dir) {
    const nums = this.#numbers(), order = this.state.waypoints.map((w, k) => k).filter((k) => nums[k] != null), to = order.indexOf(i) + dir;
    const now = this.progress()?.hour;
    if (now != null && (this.result?.legEnds?.[order[to]] ?? Infinity) <= now + 1e-6) return;
    return this.#moveStopTo(i, to);
  }

  /**
   * Stop i (a waypoint index) to place `to` among the stops, with its stay. Each stop owns the points
   * that shape the leg into it; every leg whose ends change loses its shaping points and goes back to
   * roads, so the route is worked out afresh there instead of threading the old legs' points.
   */
  async #moveStopTo(i, to) {
    const s = this.state, w = s.waypoints, nums = this.#numbers();
    const groups = [];
    let shaping = [];
    w.forEach((p, k) => { if (nums[k] == null) shaping.push(k); else { groups.push({ stop: k, shaping }); shaping = []; } });
    const at = groups.findIndex((g) => g.stop === i);
    if (at < 0 || to === at || to < 0 || to >= groups.length) return;
    groups.splice(to, 0, groups.splice(at, 1)[0]);
    const lo = Math.min(at, to), hi = Math.max(at, to), changed = new Set(Array.from({ length: hi - lo + 2 }, (_, k) => lo + k));
    const waypoints = [], lists = Object.fromEntries(LEG_KEYS.map((k) => [k, []]));
    // A stop's own stay and method go with it; a leg whose ends changed goes by road again.
    const take = (k, fresh) => { waypoints.push(w[k]); for (const key of LEG_KEYS) lists[key].push(fresh && ["legModes", "legVessels", "legFares", "legWays"].includes(key) ? null : (s[key]?.[k] ?? (key === "stays" ? 0 : null))); };
    groups.forEach((g, n) => {
      if (!changed.has(n)) for (const k of g.shaping) take(k, false);
      take(g.stop, changed.has(n));
    });
    for (const k of shaping) take(k, false);
    this.selected = waypoints.indexOf(w[i]);
    await this.save({ waypoints, ...lists });
  }

  /** A copy of a per-leg list with leg i set. */
  #legSet(key, i, val) { const a = [...(this.state[key] ?? [])]; while (a.length <= i) a.push(null); a[i] = val; return a; }

  /** Stay aboard past stop i: the boat goes straight on to the next stop, which remembers this one. */
  async #bypass(i) {
    const s = this.state, w = [...s.waypoints], gone = w[i], next = w[i + 1];
    if (!gone || !next) return;
    const { bypassed = [], ...stop } = gone;
    w[i + 1] = { ...next, bypassed: [...bypassed, stop, ...(next.bypassed ?? [])] };
    w.splice(i, 1);
    const vessel = s.legVessels?.[i] ?? null, cut = (key) => { const a = [...(s[key] ?? [])]; a.splice(i, 1); return a; };
    const legs = Object.fromEntries(LEG_KEYS.map((k) => [k, cut(k)]));
    for (const k of LEG_KEYS) while (legs[k].length <= i) legs[k].push(null);
    legs.legModes[i] = "sea";
    legs.legVessels[i] = vessel;
    legs.legFares[i] = null;
    legs.legWays[i] = null;
    this.selected = null;
    await this.save({ waypoints: w, ...legs });
  }

  /** Put a bypassed stop back: the boat lands there, before the stop that remembered it. */
  async #stopHere(i, b) {
    const s = this.state, w = [...s.waypoints], next = w[i], list = [...(next?.bypassed ?? [])], back = list[b];
    if (!back) return;
    list.splice(0, b + 1);
    const earlier = (next.bypassed ?? []).slice(0, b);
    const { bypassed: _, ...rest } = next;
    w[i] = list.length ? { ...rest, bypassed: list } : rest;
    w.splice(i, 0, earlier.length ? { ...back, stop: true, bypassed: earlier } : { ...back, stop: true });
    const put = (key, v) => { const a = [...(s[key] ?? [])]; while (a.length < i) a.push(null); a.splice(i, 0, v); return a; };
    await this.save({ waypoints: w, stays: put("stays", 0), legModes: put("legModes", "sea"), legMethods: put("legMethods", s.legMethods?.[i] ?? null), legVessels: put("legVessels", s.legVessels?.[i] ?? null), legFares: put("legFares", null), legWays: put("legWays", null) });
  }

  /** Leave the road where it crosses a river: a stop at the crossing, then the river to the next stop. */
  async #takeRiver(i) {
    const s = this.state, o = this.riverOffers?.find((x) => x.leg === i);
    if (!o) return;
    const [lon, lat] = this.toLonLat(o.at[0], o.at[1]), spot = { lon, lat, name: `Crossing of ${riverLabel(o.river)}`, stop: true };
    const put = (key, v) => { const a = [...(s[key] ?? [])]; while (a.length < i) a.push(null); a.splice(i, 0, v); return a; };
    const w = put("waypoints", spot), legModes = put("legModes", s.legModes?.[i] === "sea" ? "road" : s.legModes?.[i] ?? null), legMethods = put("legMethods", s.legMethods?.[i] ?? null), legVessels = put("legVessels", null), legFares = put("legFares", null), legWays = put("legWays", null);
    legModes[i + 1] = "sea"; legVessels[i + 1] = legVessels[i + 1] ?? "keelboat"; legWays[i + 1] = "river"; legFares[i + 1] = null;
    await this.save({ waypoints: w, stays: put("stays", 0), legModes, legMethods, legVessels, legFares, legWays });
  }

  /* A stop's handle: pick it up, show where it would go, drop it there. */
  #gripDown(e) {
    const grip = e.target.closest?.(".stop-grip");
    if (!grip || e.button !== 0 || !game.user.isGM || !this.leader) return;
    e.preventDefault();
    const rows = [...this.el.querySelectorAll("[data-stop-i]")];
    this.gripDrag = { i: Number(grip.dataset.grip), rows, row: grip.closest("[data-stop-i]"), to: null };
    this.gripDrag.row.classList.add("dragging");
    grip.setPointerCapture?.(e.pointerId);
  }
  #gripMove(e) {
    const d = this.gripDrag;
    if (!d) return;
    const others = d.rows.filter((r) => r !== d.row);
    const before = others.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < e.clientY; }).length;
    others.forEach((r) => r.classList.remove("drop-above", "drop-below"));
    if (others[before]) others[before].classList.add("drop-above"); else others.at(-1)?.classList.add("drop-below");
    d.to = before;
  }
  #gripUp() {
    const d = this.gripDrag;
    if (!d) return;
    this.#gripEnd();
    if (d.to == null) return;
    const nums = this.#numbers(), order = this.state.waypoints.map((w, k) => k).filter((k) => nums[k] != null);
    // Only stops not yet reached have handles: the first of them is where the movable ones begin.
    this.#moveStopTo(d.i, order.indexOf(Number(d.rows[0].dataset.stopI)) + d.to);
  }
  #gripEnd() {
    const d = this.gripDrag;
    if (!d) return;
    d.row.classList.remove("dragging");
    d.rows.forEach((r) => r.classList.remove("drop-above", "drop-below"));
    this.gripDrag = null;
    this.render();
  }

  async #removeStop(i) {
    const s = this.state;
    if (!(i >= 0 && i < s.waypoints.length)) return;
    const cut = (a) => { const x = [...(a ?? [])]; x.splice(i, 1); return x; };
    this.selected = null;
    await this.save({ waypoints: cut(s.waypoints), ...Object.fromEntries(LEG_KEYS.map((k) => [k, cut(s[k])])) });
  }

  #global(e) { const r = canvas.app.view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  #stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  #hit(list, g, px = HIT_PX) {
    const layer = this.getLayer();
    let bi = -1, bd = px;
    list.forEach((w, i) => { const s = layer.toScreen(w.lon, w.lat), d = Math.hypot(s[0] - g[0], s[1] - g[1]); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }
  /** The encounter under a screen point (the journey's own or the map editor's), or null. */
  #encounterAt(g, px = 14) {
    const layer = this.getLayer(), own = this.state.encounters ?? [];
    let best = null, bd = px;
    for (const e of [...own.map((x) => ({ ...x, own: true })), ...this.getEncounters().map((x) => ({ ...x, own: false }))]) {
      const [lon, lat] = e.own ? this.#placeOf(e) : [e.lon, e.lat];
      const s = layer.toScreen(lon, lat), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** A stop at a screen point, snapped to a place close by, else onto a road close by. */
  #snap(g) {
    const layer = this.getLayer();
    // A place whose name or marker is drawn under the pointer (clicking its name picks it).
    const drawn = layer.placeAt?.(canvas.stage.worldTransform.applyInverse({ x: g[0], y: g[1] }), 6);
    const named = typeof drawn === "string" && !/^(encounter|river-hazard):/.test(drawn) ? this.getPlaces().find((q) => q.id === drawn && !q.hidden) : null;
    if (named) return { lon: named.lon, lat: named.lat, name: named.name };
    let best = null, bd = SNAP_PX;
    for (const p of this.getPlaces()) {
      if (p.hidden) continue;
      const s = layer.toScreen(p.lon, p.lat), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) return { lon: best.lon, lat: best.lat, name: best.name };
    let at = layer.fromScreen(...g), rd = SNAP_PX;
    for (const f of this.getRoutes().features) {
      const pts = f.geometry.coordinates.map((c) => layer.toScreen(...c));
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((g[0] - ax) * dx + (g[1] - ay) * dy) / l)), qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx - g[0], qy - g[1]);
        if (d < rd) { rd = d; at = layer.fromScreen(qx, qy); }
      }
    }
    return { lon: at[0], lat: at[1], name: this.placeName(at[0], at[1]) };
  }

  /** Where one of the journey's encounters sits: at its night's camp (wherever that has moved), else where it was put. */
  #placeOf(e) {
    const hour = e.rest ? this.camps?.[(e.rest.night ?? 0) - 1] : null, p = hour != null ? this.#at(hour) : null;
    return p ? this.toLonLat(p[0], p[1]) : [e.lon, e.lat];
  }

  /** The camp (where a night's rest falls) nearest a screen point, within `px`: { night, hour, at: [lon, lat] }, or null. */
  #campAt(g, px = 18) {
    const layer = this.getLayer();
    let best = null, bd = px;
    (this.camps ?? []).forEach((hour, k) => {
      const p = this.#at(hour);
      if (!p) return;
      const ll = this.toLonLat(p[0], p[1]), sc = layer.toScreen(ll[0], ll[1]), d = Math.hypot(sc[0] - g[0], sc[1] - g[1]);
      if (d < bd) { bd = d; best = { night: k + 1, hour, at: ll }; }
    });
    return best;
  }

  /**
   * The journey's encounters set in camp, at their night's camp (camps: travel hours, night 1 first).
   * One set before nights were counted goes to the camp nearest where it sits.
   */
  #withCamps(encounters, camps) {
    const own = new Map((this.state.encounters ?? []).map((e) => [e.id, e]));
    return encounters.map((e) => {
      const o = own.get(e.id);
      if (!o?.rest || !camps.length) return e;
      const k = o.rest.night != null ? Math.min(camps.length, o.rest.night) - 1 : camps.reduce((b, c, i) => (Math.abs(c - e.hour) < Math.abs(camps[b] - e.hour) ? i : b), 0);
      return { ...e, hour: camps[k], rest: { ...o.rest, night: o.rest.night ?? k + 1 } };
    }).sort((a, b) => a.hour - b.hour);
  }

  /** The route point nearest a screen point, within `px`: { at: [lon, lat], leg }, or null. */
  #onRoute(g, px = 20) {
    const layer = this.getLayer(), track = this.result?.track ?? [];
    let best = null, bd = px;
    for (const q of track) {
      const ll = this.toLonLat(q.at[0], q.at[1]), s = layer.toScreen(ll[0], ll[1]), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
      if (d < bd) { bd = d; best = { at: ll, leg: q.leg, hour: q.hour }; }
    }
    return best;
  }

  async #down(e) {
    if (!this.mode || canvas.tokens?.hover) return;
    const g = this.#global(e), s = this.state;
    if (this.mode === "encounter") {
      const list = s.encounters ?? [], hit = this.#encounterAt(g);
      // A right-click removes (on release, unmoved: a right-drag pans the map).
      if (e.button === 2) {
        if (hit?.own) this.right.down(e, () => this.save({ encounters: (this.state.encounters ?? []).filter((x) => x.id !== hit.id) }));
        else if (hit) this.right.down(e, () => ui.notifications.info("KG Realms: that encounter was placed in the map editor; remove it there."));
        return;
      }
      if (e.button !== 0) return;
      this.#stop(e);
      // On an encounter: drag to move it (it snaps onto the route), or click for its settings.
      if (hit) { this.encDrag = { id: hit.id, own: hit.own, start: g, moved: false, lon: hit.lon, lat: hit.lat }; return; }
      const spot = this.#onRoute(g);
      if (!spot) return ui.notifications.info("Click on the route to place an encounter.");
      // A new encounter, then its card to fill in.
      const id = foundry.utils.randomID();
      await this.save({ encounters: [...list, { id, lon: spot.at[0], lat: spot.at[1], name: "Encounter", dc: null, radius: ENCOUNTER_MI }] });
      this.openEncounter?.(id, true, { edit: true });
      return;
    }
    // Route: a stop under the pointer is picked up (and selected); on the route line, a new stop
    // goes into that leg; anywhere else, a new stop goes on the end. Encounters are left alone.
    const i = this.#hit(s.waypoints, g, 16);
    if (i < 0 && e.button === 0 && this.#encounterAt(g, 10)) { this.#stop(e); return ui.notifications.info("KG Realms: to move an encounter, use Add encounters and drag it."); }
    if (e.button === 2) { if (i >= 0) this.right.down(e, () => this.#removeStop(i)); return; }
    if (e.button !== 0) return;
    this.#stop(e);
    if (i >= 0) { this.selected = i; this.drag = { i, moved: false }; this.draw(); this.render(); return; }
    const hit = this.#onRoute(g, 10);
    // Not on the way already travelled (0.96.7).
    const nowHour = s.trip ? this.progress()?.hour : null;
    if (hit && nowHour != null && Number.isFinite(hit.hour) && hit.hour <= nowHour + 1e-6) return ui.notifications.warn("KG Realms: the party has already travelled that part of the route. Click the route ahead of them.");
    if (hit) {
      const at = hit.leg, cut = (a, v) => { const x = [...(a ?? [])]; while (x.length < at) x.push(null); x.splice(at, 0, v); return x; };
      this.selected = at;
      this.drag = { i: at, moved: false };
      // The new stop splits a leg: both halves keep its way of going (a sea leg stays at sea).
      await this.save({ waypoints: cut(s.waypoints, this.#snap(g)), stays: cut(s.stays, 0), legModes: cut(s.legModes, s.legModes?.[at] ?? null), legMethods: cut(s.legMethods, s.legMethods?.[at] ?? null), legVessels: cut(s.legVessels, s.legVessels?.[at] ?? null), legFares: cut(s.legFares, null), legWays: cut(s.legWays, s.legWays?.[at] ?? null) });
      return;
    }
    // The first click sets the end. Every click after that adds a stop.
    const spot = this.#snap(g), w = s.waypoints;
    if (!w.length) { this.selected = 0; return this.save({ waypoints: [spot] }); }
    return this.#insertStop(spot);
  }

  /** A place put into the journey as a stop, in the leg where it adds the least way. */
  async #insertStop(spot) {
    const s = this.state, sts = this.stops().map((w) => this.toSource(w.lon, w.lat)), p = this.toSource(spot.lon, spot.lat);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Not into a leg already behind the party.
    const now = this.progress()?.hour, ends = this.result?.legEnds ?? [], lo = now == null ? 0 : Math.max(0, ends.findIndex((h) => h > now + 1e-6));
    let at = lo, best = Infinity;
    for (let i = lo; i < sts.length - 1; i++) { const extra = d(sts[i], p) + d(p, sts[i + 1]) - d(sts[i], sts[i + 1]); if (extra < best) { best = extra; at = i; } }
    // stops() starts with the party: leg i ends at waypoint i.
    const cut = (a, v) => { const x = [...(a ?? [])]; while (x.length < at) x.push(null); x.splice(at, 0, v); return x; };
    this.selected = at;
    await this.save({ waypoints: cut(s.waypoints, { ...spot, stop: true }), stays: cut(s.stays, 0), legModes: cut(s.legModes, s.legModes?.[at] ?? null), legMethods: cut(s.legMethods, s.legMethods?.[at] ?? null), legVessels: cut(s.legVessels, s.legVessels?.[at] ?? null), legFares: cut(s.legFares, null), legWays: cut(s.legWays, s.legWays?.[at] ?? null) });
  }
  #move(e) {
    if (this.mode === "encounter" && this.encDrag) {
      this.#stop(e);
      const g = this.#global(e), d = this.encDrag;
      if (!d.moved && Math.hypot(g[0] - d.start[0], g[1] - d.start[1]) < 4) return;
      d.moved = true;
      // The journey's own encounters snap to a camp close by (an encounter in camp), else onto the route.
      const camp = d.own ? this.#campAt(g) : null;
      const on = camp ? null : this.#onRoute(g, 40), at = camp ? camp.at : on ? on.at : this.getLayer().fromScreen(...g);
      d.camp = camp;
      [d.lon, d.lat] = at;
      if (d.own) this.draw();
      else { const layer = this.getLayer(), all = layer.encounters ?? {}; if (all[d.id]) layer.setEncounters({ ...all, [d.id]: { ...all[d.id], lon: d.lon, lat: d.lat } }); }
      return;
    }
    if (this.mode !== "route" || !this.drag) return;
    this.#stop(e);
    this.drag.moved = true;
    this.drag.to = this.#snap(this.#global(e));
    const w = [...this.state.waypoints]; w[this.drag.i] = this.drag.to;
    this.getLayer()?.setJourney(null, w.map((p, k) => ({ at: [p.lon, p.lat], label: `${k + 1}`, name: p.name ?? "", kind: "stop", selected: k === this.drag.i })));
  }

  async #up(e) {
    if (e.button === 2) return this.right.up(e);
    if (this.mode === "encounter" && this.encDrag) {
      this.#stop(e);
      const d = this.encDrag;
      this.encDrag = null;
      if (!d.moved) return this.openEncounter?.(d.id, d.own, { edit: true });
      if (d.own) {
        // Dropped on a camp: the GM says which watch it comes in (or at random, with the watch
        // dice), and an hour into the night for when that watch never happens (4, halfway, unless
        // it had one). Dropped anywhere else: met on the way.
        let rest = null, pick = null;
        if (d.camp) {
          const len = this.state.rest, window = Math.min(8, len), lead = len - window, pl = this.camp.plan(), members = this.camp.members();
          const old = (this.state.encounters ?? []).find((x) => x.id === d.id)?.rest, was = this.state.watch?.encWatch?.[d.id];
          const name = (id) => members.find((m) => m.id === id)?.name ?? "?";
          const opts = [...pl.watches.map((w, i) => [String(i), `Watch ${i + 1}, ${name(w.id)}${w.with?.length ? ` and ${w.with.length} more` : ""}`]), ["random", "At random (the watch dice)"]];
          const fallback = old?.at != null ? Math.max(0, Math.min(window, old.at - lead)) : window / 2;
          const got = await RealmDialog.prompt({
            window: { title: "Encounter in camp" },
            content: `<p>This encounter comes during night ${d.camp.night}'s rest. Which watch?</p>
              <label>Comes in <select name="watch">${opts.map(([v, l]) => `<option value="${v}" ${String(was ?? "random") === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
              <label>If that watch never happens, <input type="number" name="at" min="0" max="${window}" step="0.5" value="${fallback}" style="width:4.5em"> hours into the night</label>
              <p class="hint">${pl.watches.length ? "The watch order is the camp's; it can change before the rest begins, here or in the camp panel." : "No one keeps watch yet: it comes at random, or at the hour below."} The night is the rest's last ${window} hours.</p>`,
            ok: { label: "Set", icon: "fa-solid fa-campground", callback: (ev, b) => ({ watch: b.form?.elements.watch?.value ?? "random", at: Number(b.form?.elements.at?.value) }) },
            rejectClose: false
          }).catch(() => null);
          if (!got || !Number.isFinite(got.at)) { this.draw(); return; }
          rest = { night: d.camp.night, at: lead + Math.max(0, Math.min(window, got.at)) };
          pick = got.watch === "random" ? "random" : Number(got.watch);
        }
        const encounters = (this.state.encounters ?? []).map((x) => { if (x.id !== d.id) return x; const y = { ...x, lon: d.lon, lat: d.lat }; if (rest) y.rest = rest; else delete y.rest; return y; });
        await this.save({ encounters, ...(pick != null ? { watch: { ...(this.state.watch ?? {}), encWatch: { ...(this.state.watch?.encWatch ?? {}), [d.id]: pick } } } : {}) });
      }
      else await this.saveWorldEncounter?.(d.id, { lon: d.lon, lat: d.lat });
      return;
    }
    if (this.mode !== "route" || !this.drag) return;
    this.#stop(e);
    const { i, moved, to } = this.drag;
    this.drag = null;
    if (moved && to) { const w = [...this.state.waypoints]; w[i] = w[i]?.stop ? { ...to, stop: true } : to; await this.save({ waypoints: w }); }
  }
}
