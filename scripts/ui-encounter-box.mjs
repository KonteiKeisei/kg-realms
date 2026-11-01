import { shellHead, movable, placeKept, isLocked, toggleLocked } from "./ui-shell.mjs";
import {journeyScenes} from './party-groups.mjs';
// The encounter box: on a scene an encounter links to (the GM went there to run it), a small box
// in place of the travel panel, for the GM. It names the encounter, and Assets opens what it has:
// its actors (open one, or drag it onto the scene), its pictures, its pinned journal and its card.
// While a journey waits at the encounter it also has Carry on, and the way back to the map.
import { assetStrip, assetDrag, openPinned, openDoc } from "./place-card.mjs";
import { uiBounds } from "./ui-editbar.mjs";
import { isPrimaryGM } from "./authority.mjs";
import { writeJourney } from "./journey-write.mjs";
import { journeyKey } from "./journey-state.mjs";

const MODULE_ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** A permanent hazard's record can hold the journey at several separate passage IDs. */
export function heldEncounterId(state, id) {
  const now=state?.now,e=now?.encounter;
  return now?.status==="encounter"&&(e?.id===id||e?.sourceId===id)?e.id:null;
}

export class EncounterBox {
  /**
   * worldEncounters(): { [world]: { [id]: encounter } } (the map editor's); openCard(ref).
   * Encounters on journeys are read from each realm scene's journey flag.
   */
  constructor(options) {
    Object.assign(this, options);
    this.el = null;
    this.open = false;
  }

  /** Every encounter linked to this scene: [{ ref, e, journey (the realm scene waiting at it, or null) }]. */
  #here(sceneId) {
    const out = [];
    const waiting = (realm, id) => heldEncounterId(realm.getFlag(MODULE_ID,"journey"),id)?realm:null;
    // game.scenes is a Foundry collection, not an array, so it has no flatMap.
    const realms = Array.from(game.scenes ?? []).flatMap(s=>journeyScenes(s)).filter((s) => s.getFlag(MODULE_ID, "journey"));
    for (const [world, list] of Object.entries(this.worldEncounters?.() ?? {})) for (const [id, e] of Object.entries(list ?? {})) {
      if (e.scene === sceneId) out.push({ ref: { kind: "encounter", world, id }, e, journey: realms.map((r) => waiting(r, id)).find(Boolean) ?? null });
    }
    for (const realm of realms) for (const e of realm.getFlag(MODULE_ID, "journey")?.encounters ?? []) {
      if (e.scene === sceneId) out.push({ ref: { kind: "journey", scene: realm.id, partyId:realm.partyId, id: e.id }, e, journey: waiting(realm, e.id) });
    }
    // The one a journey is waiting at first.
    return out.sort((a, b) => !!b.journey - !!a.journey);
  }

  refresh() {
    const list = game.user.isGM && canvas.scene ? this.#here(canvas.scene.id) : [];
    if (!list.length) return this.close();
    this.list = list;
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.className = "kgr-ui kgr-panel kgr-encbox";
      document.body.append(this.el);
      movable(this.el, "encbox", { redock: () => this.#place() });
      this.el.addEventListener("click", (e) => this.#click(e));
      this.el.addEventListener("dragstart", assetDrag);
    }
    const one = (x, i) => {
      const e = x.e, d = { actors: e.actors ?? (e.actor ? [e.actor] : []), images: e.images ?? [] };
      const assets = assetStrip(d);
      const has = assets || e.pinned;
      return `<div class="encbox-row" data-i="${i}">
        <div class="encbox-head"><i class="fa-solid fa-triangle-exclamation"></i><b>${esc(e.name ?? "Encounter")}</b>
          ${x.journey ? `<span class="pill">Journey waiting</span>` : ""}
</div>
        ${this.open ? `<div class="encbox-body">${has ? assets : `<p class="hint">No actors, pictures or journal yet. Add them on its card.</p>`}
          <div class="encbox-actions">
            ${e.pinned ? `<button data-act="journal"><i class="fa-solid fa-book-open"></i> Journal</button>` : ""}
            <button data-act="card"><i class="fa-solid fa-id-card"></i> Card</button>
            ${x.journey ? `<span class="sp"></span><button data-act="carry-on" title="The encounter is over: the journey goes on"><i class="fa-solid fa-play"></i> Conclude Encounter</button>
              <button data-act="map-all" class="primary" title="Everyone back to the realm map"><i class="fa-solid fa-users"></i> Back to the map</button><button data-act="map" title="View the realm map (only you)"><i class="fa-solid fa-eye"></i></button>` : ""}
          </div></div>` : ""}</div>`;
    };
    // The shell's header: its minimise folds away the actors, pictures and journal.
    const title = list.length === 1 ? list[0].e.name ?? "Encounter" : `${list.length} encounters`;
    this.el.innerHTML = shellHead({ icon: "fa-triangle-exclamation", eyebrow: "Encounter on this scene", title, lock: { attr: 'data-act="lock"', on: isLocked("encbox") }, min: { attr: 'data-act="toggle"', on: !this.open, title: this.open ? "Fold away its actors, pictures and journal" : "Show its actors, pictures and journal" } }) + `<div class="body">${list.map(one).join("")}</div>`;
    this.el.classList.toggle("locked", isLocked("encbox"));
    this.#place();
  }

  /** Top left of the open map, clear of the scene controls and any panel. */
  #place() {
    if (!this.el || placeKept(this.el, "encbox")) return;
    const b = uiBounds((el) => el === this.el || this.el.contains(el));
    Object.assign(this.el.style, { left: `${b.left + 12}px`, top: `${b.top + 12}px` });
  }

  close() { this.el?.remove(); this.el = null; }

  async #click(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "lock") { await toggleLocked("encbox"); return this.refresh(); }
    const x = this.list?.[Number(b.closest("[data-i]")?.dataset.i ?? 0)];
    if (!x) return;
    const e = x.e, act = b.dataset.act;
    if (act === "toggle") { this.open = !this.open; return this.refresh(); }
    if (act === "card") return this.openCard?.(x.ref);
    if (act === "journal") return openPinned(e.pinned);
    if (act === "actor-n") return openDoc((e.actors ?? [e.actor])[Number(b.dataset.i)]);
    if (act === "pic") return new foundry.applications.apps.ImagePopout({ src: e.images[Number(b.dataset.i)], window: { title: e.name } }).render(true);
    if (act === "carry-on" && x.journey) {
      if (!isPrimaryGM()) return ui.notifications.info("KG Realms: the primary GM controls the journey.");
      const s = x.journey.getFlag(MODULE_ID, "journey");
      const held=heldEncounterId(s,x.ref.id);if(!held)return this.refresh();
      await writeJourney(x.journey, (fresh) => heldEncounterId(fresh,x.ref.id)===held?({ [`trip.resumed.${held}`]: fresh.trip?.resumed?.[held] ?? game.time.worldTime }):null, { trip: journeyKey(s) });
      await this.onJourneyChanged?.(x.journey);
      ui.notifications.info(`KG Realms: ${e.name ?? "the encounter"} is over; the journey goes on.`);
      return this.refresh();
    }
    if (act === "map") return x.journey?.view();
    if (act === "map-all") return x.journey?.activate();
  }
}
