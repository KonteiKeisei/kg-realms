// Seed exported module encounters once. A GM's later deletion stays deleted.
export function adoptEncounterDefaults(defaults, own = {}, history = {}) {
  const records = structuredClone(own), imported = new Set(history.imported ?? []), retired = new Set(history.retired ?? []);
  for (const [id, record] of Object.entries(defaults.encounters ?? {})) {
    if (imported.has(id)) continue;
    if (!(id in records)) records[id] = structuredClone(record);
    else if (records[id] && ![records[id].known, records[id].summary, records[id].notes].some(s => String(s ?? '').trim()) && record.known) records[id].known = record.known;
    imported.add(id);
  }
  for (const id of defaults.retired ?? []) {
    if (retired.has(id)) continue;
    delete records[id];
    retired.add(id);
  }
  return {records, history:{imported:[...imported], retired:[...retired]}};
}

