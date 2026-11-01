import {partyScene} from './party-groups.mjs';
import { hierarchyOf } from "./map-layers.mjs";
import { defaultWorldId } from "./worlds.mjs";
import {entranceType} from './settlement-entry.mjs';
// What the place card shows and saves for each kind of place: realm places (the world's place
// edits), local places (their notes on a local map), encounters placed in the map editor (a world
// setting) and a journey's own encounters (the realm scene's journey flag). Old journal links are
// shown as a GM-only secret block until saved or imported (journals.mjs), never opened.
import { CATEGORIES, VISIBILITY } from "./local-places.mjs";
import { localMapOf, localOf } from "./local-maps.mjs";
import { asHtml, asSecret } from "./place-card.mjs";
import { iconFor } from "./ui-card.mjs";
import { isHazard, hazardSubtype, normalizeEncounter, RIVER_HAZARDS } from "./river-hazards.mjs";
import { openTradeEditor } from "./ui-trade.mjs";
import {ICON_PACKS,resolvedIconPack,iconPackOverride,iconPackOptions} from './local-icon-packs.mjs';

const MODULE_ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
// Each field has a group: the card's edit form draws each group as one box (place-card.mjs).
const TEXT = (k, label, extra = {}) => ({ name: k, label, type: "text", group: "identity", ...extra });
const ART = { name: "img", label: "Art", type: "image", group: "identity" };
const WHO = { name: "visibility", label: "Who sees it", type: "visibility", group: "who", options: Object.entries(VISIBILITY) };
const KNOWN = { name: "known", label: "What is known · players, once Discovered", type: "rich", group: "text", hint: "Secret blocks stay with you until you reveal them on the card." };
const RUMOURS = { name: "rumours", label: "Rumours · what players hear while it is Rumoured", type: "rich", group: "who" };
const GM_NOTES = { name: "gmNotes", label: "GM notes · only you", type: "rich", group: "text" };
const ACTOR = { name: "actor", label: "Actor", type: "doc", doc: "Actor", icon: "fa-user", group: "links" };
/** How an encounter is noticed: the party rolls Perception when it is met, or passive Perception only. */
const PERCEPTION = [["active", "Wisdom (Perception) checks"], ["passive", "Passive Perception only"]];
const sceneField = (except) => ({ name: "scene", label: "Scene", type: "doc", doc: "Scene", icon: "fa-map", except, group: "links" });

/** An old journal link's text, as a secret block (empty when there is none). */
export function legacyText(uuid) {
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  const html = doc?.text?.content ?? doc?.pages?.contents?.map((p) => p.text?.content ?? "").join("") ?? "";
  return asSecret(html);
}
const legacyImage = (uuid) => { const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null; return doc?.type === "image" ? doc.src : ""; };
/** "" and null both mean: nothing. */
const val = (v) => (v === "" || v === undefined ? null : v);
/** The scene button for a linked scene: Enter (a local map) or Go to. */
function enterFor(sceneId, name) {
  const scene = sceneId ? game.scenes.get(sceneId) : null;
  if (!scene) return null;
  return { scene: scene.id, label: localMapOf(scene) ? `Enter ${name}` : `Go to ${scene.name}` };
}

/**
 * deps: realmPlaces(world) (async, edits applied), savePlaceEdit(world, id, fields), removePlace(world, id),
 * localMaps, presetFor(place), setupLocal(preset), locate(lon, lat), encounters(world), saveEncounters(world, fn).
 */
export function registerKinds(cards, deps) {
  cards.placeChoices = async ref => {
    const world = ref.world ?? localMapOf(game.scenes.get(ref.scene))?.world ?? defaultWorldId();
    const places = await deps.realmPlaces(world);
    const entries = places.filter(p => !p.removed && (game.user.isGM || (!p.hidden && p.visibility !== 'hidden'))).map(p => ({
      name: p.name, where: `${p.class || 'Place'}: ${world}`, ref: {kind: 'realm', world, id: p.id}
    }));
    for (const scene of game.scenes) {
      const map = localMapOf(scene);
      if (!map || map.world !== world) continue;
      for (const note of scene.notes) {
        const rec = localOf(note);
        if (!rec || (!game.user.isGM && rec.visibility === 'hidden')) continue;
        entries.push({name: rec.name, where: `${(CATEGORIES[rec.category] ?? CATEGORIES.other).label}: ${map.name || scene.name}`, ref: {kind: 'local', scene: scene.id, note: note.id}});
      }
    }
    return entries;
  };
  /* ------------------------------------------------------------ realm places */
  const realm = async (ref) => (await deps.realmPlaces(ref.world)).find((p) => p.id === ref.id) ?? null;
  cards.register("realm", {
    async get(ref) {
      const p = await realm(ref);
      if (!p) return null;
      const scene = p.scene ? game.scenes.get(p.scene) : null, map = localMapOf(scene);
      const local = map?.placeId === p.id;
      // Where it sits in the realms, worked out from their borders and links. Hidden ones only for the GM.
      const places = hierarchyOf(p, await deps.realmPlaces(ref.world), { showHidden: game.user.isGM });
      const shown = (list) => (list.length ? list.map((t) => t.name).join(", ") : null);
      // A description from the Forgotten Realms Wiki (CC BY-SA) credits and links its article.
      const src = !p.summary && p.descr && p.descrSource?.url ? `<p class="kgr-credit">From the <a href="${esc(p.descrSource.url)}" target="_blank" rel="noopener">${esc(p.descrSource.name ?? "Forgotten Realms Wiki")}</a>, CC BY-SA.</p>` : "";
      const known = p.known ?? `${asHtml(p.summary || p.descr)}${src}${legacyText(p.page)}`;
      const preset = game.user.isGM && !local ? await deps.presetFor(p) : null;
      let trade = null;
      try { trade = await deps.trade?.get(ref.world, p); } catch (error) { console.warn("kg-realms | trade:", error); }
      return {
        trade,
        name: p.name, type: p.class ?? "Place", icon: iconFor(p), subtitle: [p.alt, p.location].filter(Boolean).join(", "),
        img: p.img || legacyImage(p.page), known, gmNotes: p.gmNotes ?? "", rumours: p.rumours ?? "", visibility: p.visibility ?? (p.hidden ? "hidden" : "discovered"),
        actor: p.actor ?? null, url: p.url ?? null, locate: true,
        enter: enterFor(p.scene, p.name),
        rows: [["Part of", shown(places.within)], ["Crosses", shown(places.crosses)], ["Factions", p.factions ? p.factions.split(",").slice(0, 5).join(", ") : null]],
        gmActions: preset ? [{ act: "setup", label: `Set up the local map (${preset.places} places)`, icon: "fa-map-location-dot" }] : [],
        // Any place can go: one the GM added is deleted, one the module ships is removed from this
        // world (restored from the map editor's Places tab).
        canDelete: true, deleteLabel: p.added ? "Delete" : "Remove from the map",
        deleteNote: p.added ? null : "Gone from this world: off the map, out of search and journeys. Restore it from the map editor's Places tab (Removed from this world), with its edits.",
        form: { name: p.name, class: p.class ?? "", visibility: p.visibility ?? (p.hidden ? "hidden" : "discovered"), img: p.img ?? "", known, rumours: p.rumours ?? "", gmNotes: p.gmNotes ?? "", scene: p.scene ?? "", actor: p.actor ?? "", gold: !!p.gold, port: !!(p.port ?? deps.autoPort?.(p)) },
        fields: [ART, TEXT("name", "Name", { wide: true }), TEXT("class", "Type", { placeholder: "Town, Ruins, Temple..." }), { name: "gold", label: "Gold on the map", type: "check", group: "identity" },
          { name: "port", label: "Port: the party can take a boat here", type: "check", group: "identity" },
          WHO, RUMOURS, KNOWN, GM_NOTES, sceneField(), ACTOR]
      };
    },
    async editTrade(ref) { const p = await realm(ref); if (p && deps.trade) return openTradeEditor({ service: deps.trade, world: ref.world, place: p, changed: () => cards.refresh() }); },
    async save(ref, v) {
      const p = await realm(ref);
      if (!p) return;
      const out = {};
      if ("name" in v) out.name = p.added ? v.name || p.name : v.name && v.name !== p.original ? v.name : null;
      if ("class" in v && v.class && v.class !== p.class) out.class = v.class;
      if ("visibility" in v) { out.visibility = v.visibility === "discovered" ? null : v.visibility; out.hidden = v.visibility === "hidden" ? true : null; }
      for (const k of ["img", "rumours", "gmNotes", "scene", "actor"]) if (k in v) out[k] = val(v[k]);
      // What is known takes over from the card text and the old journal page.
      if ("known" in v) { out.known = val(v.known); out.summary = null; out.page = null; }
      if ("gold" in v) out.gold = v.gold === !!(v.scene ?? p.scene) ? null : v.gold;
      // A port as the map has it (by the water) is not stored: only the GM's change from that.
      if ("port" in v) out.port = v.port === !!deps.autoPort?.(p) ? null : v.port;
      await deps.savePlaceEdit(ref.world, ref.id, out);
    },
    remove: (ref) => deps.removePlace(ref.world, ref.id),
    async enter(ref, all) {
      const p = await realm(ref), scene = p?.scene ? game.scenes.get(p.scene) : null;
      if (!game.user.isGM || !scene) return;
      return all ? scene.activate() : scene.view();
    },
    async locate(ref) { const p = await realm(ref); if (p) deps.locate(p.lon, p.lat, p); },
    async act(ref, act) {
      if (act !== "setup") return;
      const p = await realm(ref), preset = p ? await deps.presetFor(p) : null;
      const r = preset ? await deps.setupLocal(preset) : null;
      if (r?.scene) { ui.notifications.info(`KG Realms: ${p.name}'s local map is set up: ${r.places} places on ${r.scene.name}.`); }
    }
  });

  /* ------------------------------------------------------------ local places */
  const note = (ref) => game.scenes.get(ref.scene)?.notes.get(ref.note) ?? null;
  cards.register("local", {
    get(ref) {
      const n = note(ref), rec = localOf(n);
      if (!rec) return null;
      const cat = CATEGORIES[rec.category] ?? CATEGORIES.other, map = localMapOf(n.parent);
      const known = rec.known ?? `${asHtml(rec.summary)}${legacyText(rec.journal)}`;
      return {
        name: rec.name, type: cat.label, icon: cat.icon, subtitle: map ? `in ${map.name}` : n.parent.name,
        img: rec.img || legacyImage(rec.journal), known, gmNotes: asHtml(rec.gmNotes), rumours: rec.rumours ?? "", visibility: rec.visibility ?? "discovered",
        actor: rec.actor ?? null, locate: canvas.scene?.id === ref.scene, enter: enterFor(rec.scene, rec.name),
        rows: entranceType(rec) ? [['Arrival', entranceType(rec) === 'dock' ? 'Dock entrance' : 'Land entrance'], ['Access',rec.privateEntry ? 'Private, entry may be prohibited without permission' : 'Public']] : [], canDelete: true,
        gmActions:map&&deps.cityTravel?[{act:'travel',label:'Travel here',icon:'fa-person-walking'}]:[],
        form: { name: rec.name, category: rec.category, visibility: rec.visibility, img: rec.img ?? "", known, rumours: rec.rumours ?? "", gmNotes: asHtml(rec.gmNotes), scene: rec.scene ?? "", actor: rec.actor ?? "", iconSize: n.iconSize, iconPack:iconPackOverride(rec.iconPack)??'', keyPlace: !!rec.keyPlace, entry: !!rec.entry, entryType: rec.entryType ?? '', privateEntry: !!rec.privateEntry },
        fields: [ART, TEXT("name", "Name", { wide: true }), { name: "category", label: "Category", type: "select", group: "identity", options: Object.entries(CATEGORIES).map(([k, c]) => [k, c.label]) },
          WHO, RUMOURS, KNOWN, GM_NOTES, sceneField(ref.scene), ACTOR,
          {name:'iconPack',label:'Icon pack',type:'icon-pack',group:'map',defaultPack:resolvedIconPack(map),options:[['',`Use map default (${ICON_PACKS[resolvedIconPack(map)]})`],...iconPackOptions()]},
          { name: "iconSize", label: "Marker size", type: "number", group: "map", attrs: 'min="16" max="200" step="4"' },
          { name: "keyPlace", label: "Key place: always shown, even zoomed far out (gates, landmarks and wards always are)", type: "check", group: "map" }, { name: "entry", label: "A way in (a gate, a dock): travel puts the party here", type: "check", group: "map" },
          {name:'entryType',label:'Entrance type (when marked as a way in)',type:'select',group:'map',options:[['','Use category (harbour = dock)'],['land','Land entrance'],['dock','Dock entrance']]},
          {name:'privateEntry',label:'Private entrance: warn that entry may be prohibited',type:'check',group:'map'}]
      };
    },
    async save(ref, v) {
      const n = note(ref), before = localOf(n);
      if (!before) return;
      const rec = { ...before }, update = {};
      if ("name" in v) { rec.name = v.name || "Place"; update.text = rec.name; }
      for (const k of ["category", "visibility", "img", "rumours", "gmNotes"]) if (k in v) rec[k] = v[k] ?? "";
      for (const k of ["scene", "actor"]) if (k in v) rec[k] = val(v[k]);
      if ("entry" in v) rec.entry = !!v.entry;
      if ('entryType' in v) rec.entryType = ['land','dock'].includes(v.entryType) ? v.entryType : null;
      if ('privateEntry' in v) rec.privateEntry = !!v.privateEntry;
      if ('keyPlace' in v) rec.keyPlace = !!v.keyPlace;
      if ('iconPack' in v) rec.iconPack=iconPackOverride(v.iconPack);
      // What is known takes over from the summary and the old journal: the note links no journal.
      if ("known" in v) { rec.known = v.known ?? ""; rec.summary = ""; rec.journal = null; update.entryId = null; update.pageId = null; }
      if ("iconSize" in v && v.iconSize) update.iconSize = Math.max(16, Math.min(200, v.iconSize));
      update[`flags.${MODULE_ID}.local`] = rec;
      await n.update(update);
      if ("scene" in v && rec.scene !== before.scene) await deps.localMaps.linkScene(n, before.scene, rec.scene);
      if (entranceType(rec)) await deps.localMaps.entrancePlaced?.(n.parent);
    },
    async remove(ref) { const n = note(ref); if (!n) return; await deps.localMaps.unlinkScene(n); await n.delete(); },
    async act(ref,act){if(act==='travel'&&game.user.isGM){const n=note(ref);if(n)return deps.cityTravel?.open(n.parent,{note:n.id});}},
    async enter(ref, all) {
      const n = note(ref), rec = localOf(n);
      if (!game.user.isGM || !rec?.scene) return;
      if (!all) return deps.localMaps.goTo(rec.scene, n);
      await deps.localMaps.goTo(rec.scene, n);
      return game.scenes.get(rec.scene)?.activate();
    },
    locate(ref) {
      const p = canvas.notes?.get(ref.note);
      if (p && canvas.scene?.id === ref.scene) canvas.animatePan({ x: p.center.x, y: p.center.y, duration: 400 });
    }
  });

  /* ------------------------------------------------------------ encounters */
  // An encounter's assets: its actors (several), a pinned journal (the one place a journal opens
  // from KG Realms), and pictures beside the art. An older single actor is read as the first.
  const ACTORS = { name: "actors", label: "Actors", type: "docs", doc: "Actor", icon: "fa-user", group: "links" };
  const PINNED = { name: "pinned", label: "Journal (opens from the card)", type: "doc", doc: "JournalEntry", icon: "fa-book-open", group: "links" };
  const PICTURES = { name: "images", label: "Pictures", type: "images", group: "links" };
  const actorsOf = (e) => e.actors ?? (e.actor ? [e.actor] : []);
  /** An encounter kind: read(ref) the encounter, write(ref, fn(e) -> e | null) saves or deletes it. */
  const encounterKind = ({ read, write }) => ({
    get(ref) {
      const e = read(ref);
      if (!e) return null;
      const known = e.known ?? `${asHtml(e.notes)}${legacyText(e.journal)}`;
      const hazard=isHazard(e),subtype=hazardSubtype(e),hazardName=RIVER_HAZARDS[subtype]??subtype??"Hazard";
      // An encounter met in camp (a journey's own, set on a rest): when in the rest it comes.
      const camp = e.rest ? [["During the rest", `${e.rest.at ?? 0} h after camp is made`]] : [["Range", `${e.radius ?? 3} mi from the route`]];
      return {
        name: e.name ?? "Encounter", type: hazard?"Hazard":"Encounter", icon: hazard?"fa-water":"fa-triangle-exclamation", subtitle: hazard?`${hazardName}: permanent hazard`:e.rest ? "In camp, on this journey" : ref.kind === "journey" ? "On this journey" : "Placed in the map editor",
        img: e.img ?? "", known, gmNotes: e.gmNotes ?? "", rumours: "",
        // Ordinary encounters stay with the GM; discovered river hazards have public cards.
        visibility: game.user.isGM ? "discovered" : hazard?(e.visibility??"hidden"):"hidden",
        actor: null, actors: actorsOf(e), images: e.images ?? [], journal: e.pinned ?? null, locate: true, enter: enterFor(e.scene, e.name),
        rows: !game.user.isGM&&hazard?[["Hazard",hazardName]]:[["Perception DC", e.dc ?? "none"], ["Noticed by", e.perception === "passive" ? "Passive Perception only" : "Wisdom (Perception) checks"], ...camp], canDelete: true,
        form: { name: e.name ?? "Encounter", group:e.group??"",subtype:subtype??"",visibility:e.visibility??"hidden",autoDiscover:e.autoDiscover!==false,dc: e.dc ?? "", radius: e.radius ?? 3, perception: e.perception ?? "active", img: e.img ?? "", known, gmNotes: e.gmNotes ?? "", scene: e.scene ?? "", actors: actorsOf(e), pinned: e.pinned ?? "", images: e.images ?? [], restAt: e.rest?.at ?? "" },
        fields: [ART, TEXT("name", "Name", { wide: true }), TEXT("group","Encounter group"),...(hazard?[{name:"subtype",label:"Hazard subtype",type:"select",group:"identity",options:Object.entries(RIVER_HAZARDS)}]:[]), { name: "dc", label: "Perception DC (fast pace -5)", type: "number", group: "identity", attrs: 'min="0" max="30"' },
          e.rest ? { name: "restAt", label: "Hours after camp is made (if its watch never comes; the watch is chosen in the camp panel)", type: "number", group: "identity", attrs: 'min="0" max="72" step="0.5"' }
            : { name: "radius", label: "Range (miles from the route)", type: "number", group: "identity", attrs: 'min="0.5" max="50" step="0.5"' },
          { name: "perception", label: "Noticed by", type: "select", group: "identity", options: PERCEPTION },
          ...(hazard?[{name:"visibility",label:"Player visibility",type:"select",group:"identity",options:[["hidden","Hidden"],["discovered","Discovered"]]},{name:"autoDiscover",label:"Discover on first encounter",type:"check",group:"identity"}]:[]),
          KNOWN, GM_NOTES, sceneField(), ACTORS, PINNED, PICTURES]
      };
    },
    save(ref, v) {
      return write(ref, (e) => {
        const out = { ...normalizeEncounter(e) };
        if("group" in v)out.group=String(v.group??"").trim().slice(0,120);
        if(isHazard(e)&&RIVER_HAZARDS[v.subtype])out.subtype=v.subtype;
        if(isHazard(e)){out.permanent=true;if("visibility" in v)out.visibility=v.visibility;if("autoDiscover" in v)out.autoDiscover=!!v.autoDiscover;}
        if ("name" in v) out.name = v.name || "Encounter";
        if ("dc" in v) out.dc = Number.isFinite(v.dc) ? v.dc : null;
        if ("radius" in v) out.radius = Math.max(0.5, Math.min(50, Number(v.radius) || 3));
        if ("restAt" in v && out.rest) out.rest = { ...out.rest, at: Math.max(0, Number(v.restAt) || 0) };
        if ("perception" in v) out.perception = v.perception === "passive" ? "passive" : "active";
        for (const k of ["img", "gmNotes", "scene", "pinned"]) if (k in v) out[k] = val(v[k]);
        if ("actors" in v) { out.actors = v.actors ?? []; delete out.actor; }
        if ("images" in v) out.images = v.images ?? [];
        if ("known" in v) { out.known = v.known ?? ""; delete out.notes; out.journal = null; }
        return out;
      });
    },
    remove: (ref) => write(ref, () => null),
    enter(ref, all) {
      const scene = game.scenes.get(read(ref)?.scene ?? "");
      if (!game.user.isGM || !scene) return;
      return all ? scene.activate() : scene.view();
    },
    locate(ref) { const e = read(ref); if (e) deps.locate(e.lon, e.lat); }
  });
  cards.register("encounter", encounterKind({
    read: (ref) => deps.encounters(ref.world)[ref.id] ?? null,
    write: (ref, fn) => deps.saveEncounters(ref.world, (w) => {
      if (!w[ref.id]) return w;
      const e = fn(w[ref.id]);
      if (e) w[ref.id] = e; else delete w[ref.id];
      return w;
    })
  }));
  const journey = (ref) => partyScene(game.scenes.get(ref.scene),ref.partyId)?.getFlag(MODULE_ID, "journey") ?? null;
  cards.register("journey", encounterKind({
    read: (ref) => journey(ref)?.encounters?.find((e) => e.id === ref.id) ?? null,
    write: async (ref, fn) => {
      const s = journey(ref);
      if (!s || !game.user.isGM) return;
      const encounters = (s.encounters ?? []).flatMap((e) => (e.id === ref.id ? [fn(e)].filter(Boolean) : [e]));
      await partyScene(game.scenes.get(ref.scene),ref.partyId).setFlag(MODULE_ID, "journey", { ...s, encounters });
    }
  }));
}
