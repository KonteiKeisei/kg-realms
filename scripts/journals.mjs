// Journals out: once per world (GM), everything still linked to a journal (realm places, local
// places, places not yet on a local map, encounters) gets that journal's text in its card's What is
// known, as a GM-only secret block, and the link is dropped. The journals themselves are left alone.
import { asHtml, asSecret, withoutRepeats } from "./place-card.mjs";

const MODULE_ID = "kg-realms";

function pageOf(uuid) {
  const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if (!doc) return { html: "", img: "" };
  const pages = doc.documentName === "JournalEntry" ? doc.pages.contents : [doc];
  return { html: pages.map((p) => p.text?.content ?? "").join(""), img: pages.find((p) => p.type === "image")?.src ?? "" };
}

/**
 * deps: worlds() (ids with place edits), realmPlaces(world), editsOf(world), savePlaceEdit(world, id, fields),
 * saveEncounters(world, fn), encounterWorlds(). Returns how many cards took text.
 */
export async function importJournals(deps) {
  let n = 0;
  // Realm places linked to a page.
  for (const world of deps.worlds()) {
    const { edits = {}, added = {} } = deps.editsOf(world);
    const linked = Object.keys({ ...edits, ...added }).filter((id) => (edits[id] ?? added[id])?.page);
    if (!linked.length) continue;
    const places = await deps.realmPlaces(world);
    for (const id of linked) {
      const p = places.find((x) => x.id === id), { html, img } = pageOf((edits[id] ?? added[id]).page);
      const known = `${p?.known ?? asHtml(p?.summary || p?.descr)}${asSecret(html)}`;
      await deps.savePlaceEdit(world, id, { known: known || null, page: null, summary: null, ...(img && !p?.img ? { img } : {}) });
      n++;
    }
  }
  // Local places, and places not yet on a local map.
  for (const scene of game.scenes) {
    const map = scene.getFlag(MODULE_ID, "localMap");
    if (!map) continue;
    const updates = [];
    for (const note of scene.notes) {
      const rec = note.getFlag(MODULE_ID, "local");
      if (!rec?.journal) continue;
      const { html, img } = pageOf(rec.journal);
      updates.push({ _id: note.id, entryId: null, pageId: null, [`flags.${MODULE_ID}.local`]: { ...rec, known: `${rec.known ?? asHtml(rec.summary)}${asSecret(html)}`, summary: "", journal: null, img: rec.img || img } });
    }
    if (updates.length) { await scene.updateEmbeddedDocuments("Note", updates); n += updates.length; }
    if ((map.unplaced ?? []).some((u) => u.journal)) {
      const unplaced = map.unplaced.map(({ journal, ...u }) => (journal ? { ...u, known: `${u.known ?? ""}${asSecret(pageOf(journal).html)}` } : u));
      await scene.setFlag(MODULE_ID, "localMap", { ...map, unplaced });
    }
  }
  // A journey's own encounters (on the realm scenes).
  for (const scene of game.scenes) {
    const journey = scene.getFlag(MODULE_ID, "journey");
    if (!journey?.encounters?.some((e) => e.journal)) continue;
    const encounters = journey.encounters.map(({ journal, ...e }) => (journal ? { ...e, known: `${e.known ?? asHtml(e.notes)}${asSecret(pageOf(journal).html)}` } : e));
    await scene.setFlag(MODULE_ID, "journey", { ...journey, encounters });
    n += journey.encounters.filter((e) => e.journal).length;
  }
  // Encounters placed in the map editor.
  for (const world of deps.encounterWorlds()) {
    let count = 0;
    await deps.saveEncounters(world, (w) => {
      for (const [id, e] of Object.entries(w)) {
        if (!e.journal) continue;
        const { journal, notes, ...rest } = e;
        w[id] = { ...rest, known: `${e.known ?? asHtml(notes)}${asSecret(pageOf(journal).html)}` };
        count++;
      }
      return w;
    });
    n += count;
  }
  return n;
}

/**
 * Repeated text in cards (0.31.0 to 0.36.0 gave places converted from the GM's own pins their page's
 * text twice, from the preset and from the pin): every card keeps one copy. Returns how many cards
 * changed. deps as importJournals.
 */
export async function removeRepeats(deps) {
  let n = 0;
  const fix = (o, keys) => { let c = false; for (const k of keys) { const v = withoutRepeats(o?.[k]); if (o && v !== o[k]) { o[k] = v; c = true; } } return c; };
  for (const scene of game.scenes) {
    const map = scene.getFlag(MODULE_ID, "localMap");
    if (!map) continue;
    const updates = [];
    for (const note of scene.notes) {
      const rec = note.getFlag(MODULE_ID, "local");
      if (!rec) continue;
      const copy = { ...rec };
      if (fix(copy, ["known", "gmNotes", "rumours"])) updates.push({ _id: note.id, [`flags.${MODULE_ID}.local`]: copy });
    }
    if (updates.length) { await scene.updateEmbeddedDocuments("Note", updates); n += updates.length; }
    const unplaced = (map.unplaced ?? []).map((u) => ({ ...u }));
    const changed = unplaced.filter((u) => fix(u, ["known"])).length;
    if (changed) { await scene.setFlag(MODULE_ID, "localMap", { ...map, unplaced }); n += changed; }
  }
  for (const world of deps.worlds()) {
    const { edits = {}, added = {} } = deps.editsOf(world);
    for (const [id, e] of Object.entries({ ...edits, ...added })) {
      const copy = { known: e.known, gmNotes: e.gmNotes };
      if (fix(copy, ["known", "gmNotes"])) { await deps.savePlaceEdit(world, id, Object.fromEntries(Object.entries(copy).filter(([, v]) => v !== undefined))); n++; }
    }
  }
  for (const world of deps.encounterWorlds()) {
    let count = 0;
    await deps.saveEncounters(world, (w) => { for (const e of Object.values(w)) if (fix(e, ["known", "gmNotes"])) count++; return w; });
    n += count;
  }
  return n;
}