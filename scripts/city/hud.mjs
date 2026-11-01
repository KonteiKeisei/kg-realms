// The city HUD (0.69): one docked panel on a settlement map, in place of the Travel button and the
// separate trip, ride and journeys panels (tools/mockups/city-hud.html). Its views:
//  - at rest: where the party is (street, ward, time), the places it knows nearby, other parties here;
//  - planning a trip (city/ui.mjs renders into it);
//  - a journey under way (city/ride-view.mjs renders into it), with the coach view as a drawer under
//    the HUD, revealed or collapsed per client;
//  - several journeys: a tab per journey and an All tab with the shared clock's controls.
// Top right by default; movable by its header, lockable, minimised to its header, kept per client.
import { tripActive } from "./transit.mjs";
import { sceneParties, groupMembers } from "../party-groups.mjs";
import { isPrimaryGM } from "../authority.mjs";
import { observeMapUi } from "../ui-docking.mjs";
import { uiBounds } from "../ui-editbar.mjs";
import { placePanel, makeMovable, toggleLock, placeLocked } from "./panel-place.mjs";
import { shellHead, shellSection } from "../ui-shell.mjs";
import { CATEGORIES } from "../local-places.mjs";
import { cityDuration, cityPosition, project } from "./routing.mjs";
import { cityFeetPerPixel } from "./transit.mjs";

const ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
/** Each journey's colour: its tab, its route on the map, its token ring. */
export const JOURNEY_COLOURS = [0xe9bf6a, 0x7fb2d9, 0x9fd38a, 0xd98fb5, 0xc9a2ef];
const css = (n) => `#${n.toString(16).padStart(6, "0")}`;
const setting = (k, d) => { try { return game.settings.get(ID, k); } catch { return d; } };
/** A party token's middle (sceneParties gives token documents). */
const centre = (t) => { const g = canvas.scene?.grid?.size ?? 100; return [t.x + (t.width ?? 1) * g / 2, t.y + (t.height ?? 1) * g / 2]; };

export class CityHud {
  /** travel: the SettlementTravelUI (planning, routes on the map, the fleet). */
  constructor(travel) { this.travel = travel; this.focus = null; this.allPlaces = false; }

  install() {
    game.settings.register(ID, "cityHudMin", { scope: "client", config: false, type: Boolean, default: false });
    game.settings.register(ID, "cityCoachDrawer", { scope: "client", config: false, type: Boolean, default: true });
    Hooks.on("canvasReady", () => this.show());
    Hooks.on("canvasTearDown", () => this.hide());
    const soon = () => this.render();
    for (const h of ["updateToken", "createToken", "deleteToken", "updateNote", "createNote", "deleteNote", "updateActor"]) Hooks.on(h, (doc) => { if (!doc?.parent || doc.parent === canvas.scene || h === "updateActor") this.later(); });
    Hooks.on("updateUser", (user, changes) => { if (foundry.utils.hasProperty(changes, `flags.${ID}.cityAsk`)) this.later(); });
    // The clock moving changes only the time shown: not a rebuild of the HUD (each second, with Calendaria).
    Hooks.on("updateWorldTime", () => { if (this.view === "rest") this.#clock(); });
    // Clicking a party's token: that party (at rest), or that journey (travelling).
    Hooks.on("controlToken", (token, on) => {
      if (!on || token.actor?.type !== "group" || !this.el) return;
      const id = token.actor.id;
      if (this.travel.fleet.busy(id)) this.focus = id; else if (!this.travel.el) { this.party = id; this.focus = `rest:${id}`; }
      soon();
    });
  }

  later() { if (this.pending) return; this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); }); }

  /* ------------------------------------------------------------ the panel */

  show() {
    this.hide();
    if (!canvas.scene?.getFlag(ID, "localMap")) return;
    const el = this.el = document.createElement("section");
    el.className = "kgr-ui kgr-panel kgr-city-hud";
    el.innerHTML = `<header class="kgr-sh"></header><nav class="kgr-city-tabs" hidden></nav><div class="kgr-city-hud-body"></div><div class="kgr-sh-foot kgr-city-hud-foot" hidden></div><div class="kgr-city-drawer" hidden></div>`;
    document.body.append(el);
    makeMovable(el, () => this.dock());
    this.offDock = observeMapUi(() => this.dock());
    el.addEventListener("click", (e) => this.action(e).catch((error) => ui.notifications.error(error.message)));
    el.addEventListener("input", (e) => { if (e.target.matches("[data-hud-search]")) { this.query = e.target.value; this.#matches(); } });
    el.addEventListener("pointerover", (e) => { const row = e.target.closest("[data-note]"); this.#lightNote(row?.dataset.note ?? null); });
    el.addEventListener("pointerleave", () => this.#lightNote(null));
    this.render(); this.dock();
  }

  hide() {
    this.offDock?.(); this.offDock = null; this.ride?.close?.(); this.ride = null;
    this.el?.remove(); this.el = null; this.view = null; this.#lightNote(null);
  }

  dock() { if (this.el) placePanel(this.el, Math.min(360, uiBounds().right - uiBounds().left - 24)); }

  /** A fresh part of the panel for a view (old listeners go with the old node). */
  slot(name) {
    const old = this.el?.querySelector(name === "body" ? ".kgr-city-hud-body" : name === "foot" ? ".kgr-city-hud-foot" : ".kgr-city-drawer");
    if (!old) return null;
    const fresh = old.cloneNode(false); old.replaceWith(fresh); return fresh;
  }

  head({ icon, eyebrow, title, extra = "" }) {
    const h = this.el?.querySelector("header.kgr-sh"); if (!h) return;
    const min = setting("cityHudMin", false);
    // Minimised, the header still offers what matters now: a trip to plan, or the time left.
    if (min && !extra) {
      const list = this.journeys(), one = list.length === 1 ? list[0] : null;
      if (one) { const left = Math.max(0, one[1].plan.seconds - this.travel.fleet.worker(one[0]).elapsed()); extra = `<span class="kgr-sh-chip gold">${cityDuration(left)} left</span>`; }
      else if (list.length > 1) extra = `<span class="kgr-sh-chip gold">${list.length} journeys</span>`;
      else if (isPrimaryGM() && this.partyToken()) extra = `<button type="button" class="main kgr-city-slim-plan" data-act="plan"><i class="fa-solid fa-route"></i> Plan a trip</button>`;
    }
    h.outerHTML = shellHead({ icon, eyebrow, title, extra, lock: { attr: 'data-act="lock-place"', on: placeLocked() }, min: { attr: 'data-act="minimize"', on: min } });
    this.el.classList.toggle("kgr-min", min);
  }

  /* ------------------------------------------------------------ which view */

  journeys() { const scene = canvas.scene; return this.travel.fleet.active().filter(([, r]) => r.scene === scene?.id); }

  /** The parties on this scene not travelling. */
  resting() { return sceneParties(canvas.scene).filter((t) => !this.travel.fleet.busy(t.actor.id)); }

  /**
   * Which view: planning; else, with several parties here (travelling or not), a tab for each, and
   * the party or journey in focus (0.70.2): a journey's controls, a party at rest (to plan its trip),
   * or All when several journeys run at once.
   */
  render() {
    if (!this.el) return;
    const planning = !!this.travel.el, list = this.journeys(), resting = this.resting();
    const restId = this.focus?.startsWith?.("rest:") ? this.focus.slice(5) : null;
    if (restId ? !resting.some((t) => t.actor.id === restId) : this.focus && this.focus !== "all" && !list.some(([id]) => id === this.focus)) this.focus = null;
    if (this.focus === "all" && list.length < 2) this.focus = null;
    // Planning a trip: city/ui.mjs has the body and foot; tabs and the drawer step aside.
    if (planning) { this.#tabs([], []); this.closeRide(); this.#drawer(null); this.view = "plan"; return; }
    const focus = this.focus ?? (list.length > 1 ? "all" : list.length === 1 ? list[0][0] : resting[0] ? `rest:${resting[0].actor.id}` : null);
    this.#tabs(list, resting, focus);
    if (!focus || focus.startsWith("rest:")) { if (focus) this.party = focus.slice(5); this.closeRide(); return this.#rest(); }
    if (focus === "all") { this.closeRide(); return this.#all(list); }
    this.view = "journey"; this.travel.paint();
    return this.#journey(focus, list);
  }

  closeRide() { this.ride?.close?.(); this.ride = null; }

  /** The clock moved: the journey tabs' progress, and the All view's times. */
  tick() {
    if (!this.el || this.view === "plan") return;
    if (this.view === "all") return this.render();
    if (!this.el.querySelector(".kgr-city-tabs").hidden) this.#tabs(this.journeys(), this.resting(), this.shownFocus);
  }

  /** A tab for each party here (journeys first), and All with several journeys; shown with two or more. */
  #tabs(list, resting, focus = null) {
    const nav = this.el.querySelector(".kgr-city-tabs"), many = list.length + resting.length >= 2;
    this.shownFocus = focus;
    nav.hidden = !many; this.el.classList.toggle("has-tabs", many);
    if (!many) { nav.innerHTML = ""; return; }
    const all = list.length >= 2 ? `<button type="button" data-act="focus" data-id="all" class="all ${focus === "all" ? "on" : ""}">All</button>` : "";
    nav.innerHTML = all + list.map(([id, r], i) => {
      const w = this.travel.fleet.worker(id), t = w.elapsed(), left = Math.max(0, r.plan.seconds - t), mode = cityPosition(r.plan, t).mode, c = css(JOURNEY_COLOURS[i % JOURNEY_COLOURS.length]);
      return `<button type="button" data-act="focus" data-id="${esc(id)}" class="${focus === id ? "on" : ""}" style="--c:${c}"><span class="top"><i class="dot"></i><span>${esc(game.actors.get(id)?.name ?? "Party")}</span></span><span class="bar"><span style="width:${Math.round(100 * t / Math.max(1, r.plan.seconds))}%"></span></span><small>${cityDuration(left)} / ${r.phase === "paused" ? "paused" : mode === "carriage" ? "coach" : "on foot"}</small></button>`;
    }).join("") + resting.map((tk) => {
      const id = `rest:${tk.actor.id}`;
      return `<button type="button" data-act="focus" data-id="${esc(id)}" class="rest ${focus === id ? "on" : ""}"><span class="top"><i class="fa-solid fa-user-group" aria-hidden="true"></i><span>${esc(tk.name)}</span></span><small>At rest${isPrimaryGM() ? " / plan a trip" : ""}</small></button>`;
    }).join("");
  }
  /* ------------------------------------------------------------ at rest */

  /** The party shown at rest: the one clicked, else the selected token's, else the first here. */
  partyToken() {
    const parties = sceneParties(canvas.scene).filter((t) => !this.travel.fleet.busy(t.actor.id));
    return parties.find((t) => t.actor.id === this.party) ?? parties.find((t) => t.object?.controlled) ?? parties[0] ?? null;
  }

  places() {
    const gm = game.user.isGM;
    return Array.from(canvas.scene?.notes ?? []).map((n) => ({ n, rec: n.getFlag(ID, "local") })).filter(({ rec }) => rec && rec.category !== "district" && (rec.visibility === "discovered" || (gm && !rec.visibility)));
  }

  #rest() {
    this.view = "rest";
    const scene = canvas.scene, map = scene.getFlag(ID, "localMap"), token = this.partyToken(), gm = game.user.isGM, primary = isPrimaryGM();
    const at = token ? centre(token) : null;
    this.head({ icon: "fa-city", eyebrow: [map?.name ?? scene.name, at ? this.#ward(at) : null].filter(Boolean).join(" / "), title: token?.name ?? "No party here" });
    const body = this.slot("body"), foot = this.slot("foot");
    const street = at ? this.#street(at) : null, time = game.time?.components, members = token ? groupMembers(token.actor).length : 0;
    const clock = this.#clockText();
    const chips = [street ? `<span class="kgr-sh-chip gold"><i class="fa-solid fa-location-dot"></i>${esc(street)}</span>` : "", clock ? `<span class="kgr-sh-chip"><i class="fa-solid fa-clock"></i><span data-clock>${clock}</span></span>` : "", token ? `<span class="kgr-sh-chip"><i class="fa-solid fa-users"></i>${members} in the party</span>` : ""].join("");
    const asks = this.asks(), others = sceneParties(scene).filter((t) => t !== token);
    body.innerHTML = `${chips ? `<div class="kgr-city-chips">${chips}</div>` : ""}
      <label class="kgr-sh-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" data-hud-search placeholder="${primary ? "Go to a place, or click one on the map" : "Find a place you know"}" aria-label="Find a place" value="${esc(this.query ?? "")}"></label>
      <div class="kgr-city-matches" data-matches></div>
      <div data-nearby></div>
      ${others.length ? shellSection("Other parties here", others.map((t) => { const busy = this.travel.fleet.busy(t.actor.id), s = this.#street(centre(t)); return `<div class="kgr-sh-row"><span class="kgr-sh-ico"><i class="fa-solid ${busy ? "fa-route" : "fa-user-group"}"></i></span><span class="kgr-sh-main"><b>${esc(t.name)}</b><small>${busy ? "Travelling" : esc(s ?? "Here")}</small></span><button type="button" data-act="show-token" data-token="${esc(t.id)}">Show</button></div>`; }).join(""), { count: others.length, key: "others" }) : ""}
      ${!token ? `<p class="hint">Place a party token (a group actor) on this map to travel.</p>` : ""}`;
    this.#nearby(at, asks);
    this.#matches();
    foot.hidden = !gm;
    foot.innerHTML = gm ? `${primary ? `<button type="button" class="main" data-act="plan" ${token ? "" : "disabled"}><i class="fa-solid fa-route"></i> Plan a trip</button>` : ""}<span class="kgr-sh-sp"></span><button type="button" data-act="roads" title="Settlement roads"><i class="fa-solid fa-road"></i> Roads</button><button type="button" data-act="places" title="Local places"><i class="fa-solid fa-map-pin"></i> Places</button>` : "";
    this.#drawer(null);
  }

  #clockText() {
    const time = game.time?.components;
    return time && Number.isFinite(time.hour) ? `${((time.hour + 11) % 12) + 1}:${String(time.minute ?? 0).padStart(2, "0")} ${time.hour < 12 ? "am" : "pm"}` : null;
  }

  /** The time shown, brought up to date in place. */
  #clock() {
    const el = this.el?.querySelector("[data-clock]"), text = this.#clockText();
    if (el && text && el.textContent !== text) el.textContent = text;
  }

  #ward(at) {
    let best = null;
    for (const n of canvas.scene?.notes ?? []) { const rec = n.getFlag(ID, "local"); if (rec?.category !== "district" || (rec.visibility === "hidden" && !game.user.isGM)) continue; const d = Math.hypot(n.x - at[0], n.y - at[1]); if (!best || d < best.d) best = { d, name: rec.name }; }
    return best?.name ?? null;
  }

  streetAt(at) { return this.#street(at); }

  #street(at) {
    const roads = canvas.scene?.getFlag(ID, "cityRoads")?.roads ?? [], reach = (canvas.scene.grid?.size ?? 100) * 3;
    let best = null;
    for (const r of roads) { if (!r.name) continue; for (let i = 1; i < r.points.length; i++) { const d = project(at, r.points[i - 1], r.points[i]).distance; if (d <= reach && (!best || d < best.d)) best = { d, name: r.name }; } }
    return best?.name ?? null;
  }

  /** Minutes on foot, by straight line and a little for the turns. */
  #walk(d) {
    let fpp = 1; try { fpp = cityFeetPerPixel(canvas.scene); } catch { return null; }
    const mph = Number(setting("cityWalkMph", 3)) || 3;
    return Math.max(1, Math.round(d * fpp * 1.3 / (mph * 5280 / 60)));
  }

  #row({ n, rec }, at, ask = null) {
    const cat = CATEGORIES[rec.category] ?? CATEGORIES.other, gm = isPrimaryGM(), mins = at ? this.#walk(Math.hypot(n.x - at[0], n.y - at[1])) : null;
    const who = ask ? ask.users.map((u) => game.users.get(u)).filter(Boolean) : [];
    const mine = who.some((u) => u.isSelf);
    const faces = who.length ? `<span class="kgr-city-asks">${who.map((u) => `<img src="${esc(u.avatar)}" alt="${esc(u.name)}" data-tooltip="${esc(u.name)} asks to go">`).join("")}</span>` : "";
    const button = gm ? `<button type="button" data-act="go" data-note="${esc(n.id)}" class="${who.length ? "main" : ""}">${who.length ? "Plan it" : "Go"}</button>${who.length ? `<button type="button" class="kgr-sh-ctl" data-act="clear-ask" data-note="${esc(n.id)}" title="Clear the request" aria-label="Clear the request"><i class="fa-solid fa-xmark"></i></button>` : ""}`
      : `<button type="button" data-act="ask" data-note="${esc(n.id)}">${mine ? "Withdraw" : who.length ? "Me too" : "Ask to go"}</button>`;
    const sub = who.length ? `${esc(who.map((u) => u.name).join(", "))} ${who.length === 1 ? "asks" : "ask"} to go` : [cat.label, mins ? `${mins} min walk` : null].filter(Boolean).join(" / ");
    return `<div class="kgr-sh-row ${who.length ? "asked" : ""}" data-note="${esc(n.id)}"><span class="kgr-sh-ico"><i class="fa-solid ${cat.icon}"></i></span><span class="kgr-sh-main"><b>${esc(rec.name)}</b><small>${sub}</small></span>${faces}${button}</div>`;
  }

  #nearby(at, asks) {
    const box = this.el?.querySelector("[data-nearby]"); if (!box) return;
    const places = this.places(), asked = new Map(asks.map((a) => [a.note, a]));
    const sorted = places.filter(({ n }) => !asked.has(n.id)).sort((a, b) => at ? Math.hypot(a.n.x - at[0], a.n.y - at[1]) - Math.hypot(b.n.x - at[0], b.n.y - at[1]) : a.rec.name.localeCompare(b.rec.name));
    const pinned = asks.map((a) => places.find(({ n }) => n.id === a.note) ? [places.find(({ n }) => n.id === a.note), a] : null).filter(Boolean);
    const shown = this.allPlaces ? sorted : sorted.slice(0, 5);
    const all = places.length > 5 ? `<button type="button" class="link" data-act="all-places">${this.allPlaces ? "Fewer" : "All places"}</button>` : "";
    box.innerHTML = shellSection("Nearby", `<div class="kgr-city-nearby ${this.allPlaces ? "all" : ""}">${pinned.map(([p, a]) => this.#row(p, at, a)).join("")}${shown.map((p) => this.#row(p, at)).join("") || '<p class="hint">No places known here yet.</p>'}</div>`, { count: `${places.length} known`, key: "nearby", action: all });
  }

  #matches() {
    const box = this.el?.querySelector("[data-matches]"); if (!box) return;
    const q = (this.query ?? "").trim().toLowerCase(), token = this.partyToken(), at = token ? centre(token) : null;
    const list = q ? this.places().filter(({ rec }) => rec.name.toLowerCase().includes(q)).slice(0, 8) : [];
    box.innerHTML = list.map((p) => this.#row(p, at)).join("") || (q ? '<p class="hint">No place you know by that name.</p>' : "");
  }

  /** The asks to go, on this scene: [{ note, users, at }], newest first. Each player's own, in their user flags. */
  asks() {
    const by = new Map();
    for (const u of game.users) { const a = u.getFlag?.(ID, "cityAsk"); if (!a?.note || a.scene !== canvas.scene?.id || !canvas.scene.notes.get(a.note)) continue; const e = by.get(a.note) ?? { note: a.note, users: [], at: 0 }; e.users.push(u.id); e.at = Math.max(e.at, a.at ?? 0); by.set(a.note, e); }
    return [...by.values()].sort((a, b) => b.at - a.at);
  }

  /** Clear the asks for a place (the GM): its players' flags. */
  async clearAsks(note) {
    if (!game.user.isGM) return;
    for (const u of game.users) { const a = u.getFlag?.(ID, "cityAsk"); if (a?.note === note && a.scene === canvas.scene?.id) await u.unsetFlag(ID, "cityAsk"); }
  }

  #lightNote(id) {
    if (this.lit === id) return; this.lit = id;
    for (const n of canvas.notes?.placeables ?? []) { const m = n.kgrMarker; if (!m || m.destroyed) continue; m.tint = !id || n.id === id ? 0xffffff : 0x9a9a9a; }
  }

  /* ------------------------------------------------------------ journeys */

  #all(list) {
    this.view = "all";
    const fleet = this.travel.fleet, gm = isPrimaryGM(), going = list.filter(([, r]) => ["travelling", "paused"].includes(r.phase)), allPaused = going.length && going.every(([, r]) => r.phase === "paused");
    const rate = fleet.rate || Math.min(...list.map(([, r]) => r.rate || 1));
    this.head({ icon: "fa-route", eyebrow: `${canvas.scene.getFlag(ID, "localMap")?.name ?? canvas.scene.name} / ${list.length} journeys`, title: "All journeys" });
    const body = this.slot("body"), foot = this.slot("foot");
    const shared = gm ? `<div class="kgr-city-ride-controls"><button type="button" data-all="pause"><i class="fa-solid fa-${allPaused ? "play" : "pause"}"></i> ${allPaused ? "Resume all" : "Pause all"}</button><div class="kgr-city-speed" role="group" aria-label="Travel speed for every journey">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-all="speed" data-speed="${n}" class="${rate === n ? "on" : ""}" aria-pressed="${rate === n}">${n}x</button>`).join("")}</div><button type="button" data-all="arrive" title="The rest of every journey passes now; the nearest arrives first"><i class="fa-solid fa-forward-fast"></i> Arrive now</button></div><p class="hint">Speed and Arrive now apply to every journey: they share one clock.<span class="kgr-rule" data-tooltip="Settlement journeys run on the world clock, so one speed serves them all. Arrive now finishes the nearest journey first, so the clock moves on only as far as the longest.">?</span></p>` : "";
    const rows = list.map(([id, r], i) => {
      const w = fleet.worker(id), t = w.elapsed(), mode = cityPosition(r.plan, t).mode, c = css(JOURNEY_COLOURS[i % JOURNEY_COLOURS.length]), paused = r.phase === "paused";
      return `<div class="kgr-sh-row" style="--c:${c}"><span class="kgr-sh-ico tinted"><i class="fa-solid ${mode === "carriage" ? "fa-horse" : "fa-person-walking"}"></i></span><span class="kgr-sh-main"><b>${esc(game.actors.get(id)?.name ?? "Party")} to ${esc(r.destination.name)}</b><small>${paused ? "Paused / " : ""}${cityDuration(Math.max(0, r.plan.seconds - t))} left</small></span>${gm && ["travelling", "paused"].includes(r.phase) ? `<button type="button" class="kgr-sh-ctl" data-party="${esc(id)}" data-fleet="pause" title="${paused ? "Resume" : "Pause"} this journey" aria-label="${paused ? "Resume" : "Pause"} this journey"><i class="fa-solid fa-${paused ? "play" : "pause"}"></i></button>` : ""}<button type="button" data-act="focus" data-id="${esc(id)}">Open</button></div>`;
    }).join("");
    body.innerHTML = `${shared}${shellSection("Journeys", rows, { count: list.length, key: "journeys" })}`;
    foot.hidden = !gm;
    foot.innerHTML = gm && this.partyToken() ? `<button type="button" data-act="plan"><i class="fa-solid fa-route"></i> Plan another trip</button><span class="kgr-sh-sp"></span>` : "";
    this.#drawer(null);
    this.travel.paint();
  }

  #journey(id, list) {
    const worker = this.travel.fleet.worker(id);
    if (this.ride?.controller !== worker) { this.closeRide(); this.ride = this.travel.rideView(worker, this); }
    this.ride.sync(worker.ride, { colour: css(JOURNEY_COLOURS[Math.max(0, list.findIndex(([x]) => x === id)) % JOURNEY_COLOURS.length]), shared: list.length > 1 });
  }

  /** The coach view drawer: shown while the focused journey has a coach in it; open or shut per client. */
  #drawer(ride) {
    const d = this.el?.querySelector(".kgr-city-drawer"); if (!d) return null;
    if (!ride) { d.hidden = true; d.innerHTML = ""; this.el.classList.remove("has-drawer"); return null; }
    return d;
  }
  drawerOpen() { return !!setting("cityCoachDrawer", true); }
  async toggleDrawer() { await game.settings.set(ID, "cityCoachDrawer", !this.drawerOpen()); this.ride?.drawer?.(); }

  /* ------------------------------------------------------------ buttons */

  async action(e) {
    const b = e.target.closest("button[data-act], button[data-all], button[data-fleet], [data-act='minimize']");
    if (!b) { if (e.target.closest("header.kgr-sh") && setting("cityHudMin", false) && !e.target.closest("button")) { await game.settings.set(ID, "cityHudMin", false); this.render(); } return; }
    if (b.dataset.fleet) return this.travel.fleet.worker(b.dataset.party)[b.dataset.fleet]();
    if (b.dataset.all) return this.travel.fleet.statusAction(e);
    const act = b.dataset.act;
    if (act === "lock-place") { await toggleLock(); return this.render(); }
    if (act === "minimize") { await game.settings.set(ID, "cityHudMin", !setting("cityHudMin", false)); return this.render(); }
    if (act === "focus") { this.focus = b.dataset.id; return this.render(); }
    if (act === "all-places") { this.allPlaces = !this.allPlaces; return this.render(); }
    if (act === "roads") return this.travel.openRoads();
    if (act === "places") return this.travel.localMaps?.editor.open({ tab: "places" });
    if (act === "show-token") { const t = canvas.scene.tokens.get(b.dataset.token); if (t) { const [x, y] = centre(t); await canvas.animatePan({ x, y, duration: 500 }); } return; }
    if (act === "plan") return this.travel.open(canvas.scene, null, { party: this.partyToken()?.actor.id });
    if (act === "go") { await this.clearAsks(b.dataset.note); return this.travel.open(canvas.scene, { note: b.dataset.note }, { party: this.partyToken()?.actor.id }); }
    if (act === "clear-ask") return this.clearAsks(b.dataset.note);
    if (act === "ask") {
      const mine = game.user.getFlag(ID, "cityAsk");
      if (mine?.note === b.dataset.note && mine.scene === canvas.scene.id) return game.user.unsetFlag(ID, "cityAsk");
      return game.user.setFlag(ID, "cityAsk", { scene: canvas.scene.id, note: b.dataset.note, at: Date.now() });
    }
  }
}
