import { worldUrl } from "./worlds.mjs";
/** Location prices from the GM's trade export. All amounts are in gp, before the world scale. */
export const TRADE_GROUPS = { exports: "Exports", imports: "Imports", specialties: "Local specialties" };
export const AVAILABILITY = ["Local", "Stocked", "Special order", "Unavailable"];
export const tradeName = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
export function economyScale(value = "x1") {
  const match = /^([xd])([1-9]\d*)$/.exec(String(value));
  return match ? match[1] === "x" ? Number(match[2]) : 1 / Number(match[2]) : 1;
}
export const tradePrice = (row, scale = 1) => row.base * row.mod * scale;
// Editor amounts include the world economy; stored prices stay in catalogue gp.
export const tradeBasePrice = (row, scale = 1) => Number((row.base * scale).toPrecision(15));
export const unscaleTradeBase = (value, scale = 1) => Number((Number(value) / scale).toPrecision(15));
export const visibleTradeRows = (market, gm) => (market?.rows ?? []).filter(row => gm || !row.hidden);
export function tradeCoin(gp) {
  return gp >= 1 ? `${gp.toLocaleString("en-US", { maximumFractionDigits: 4 })} gp` : `${(gp * 100).toLocaleString("en-US", { maximumFractionDigits: 3 })} cp`;
}
export function cleanTrade(value) {
  if (!value || !Array.isArray(value.rows) || value.rows.length > 500) throw Error("Trade needs a list of up to 500 goods.");
  const text = (v, n) => String(v ?? "").trim().slice(0, n);
  const rows = value.rows.map((r, i) => {
    if (!r || !TRADE_GROUPS[r.group] || !text(r.name, 120) || !text(r.unit, 100)) throw Error(`Good ${i + 1}: enter a name, unit and trade role.`);
    if (![r.base, r.mod].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0) || !Number.isFinite(r.base * r.mod * 10)) throw Error(`Good ${i + 1}: prices and multipliers must be finite, positive numbers or zero.`);
    return { key: text(r.key || `good-${i}`, 160), good: text(r.good, 120), name: text(r.name, 120), unit: text(r.unit, 100), group: r.group, base: r.base, mod: r.mod,
      hidden: r.hidden === true, availability: AVAILABILITY.includes(r.availability) ? r.availability : "Stocked", cat: text(r.cat, 60), supplier: text(r.supplier, 200), desc: text(r.desc, 3000), source: text(r.source, 300) };
  });
  if (new Set(rows.map(r => r.key)).size !== rows.length) throw Error("Each trade entry needs its own identifier.");
  return { profile: text(value.profile, 120), rows, houses: (value.houses ?? []).map(v => text(v, 200)).filter(Boolean).slice(0, 60) };
}

export class TradeMarkets {
  constructor(options = {}) { Object.assign(this, options); this.loads = new Map(); }
  async data(world) {
    if (!this.loads.has(world)) {
      const work = Promise.resolve().then(() => this.load ? this.load(world) : fetch(worldUrl(world, "trade.json")).then(r => { if (r.status === 404) return { settlements: [], goods: [], signature_goods: [], houses: [], tags: {}, matches: {} }; if (!r.ok) throw Error(`Trade data: HTTP ${r.status}`); return r.json(); })).then(data => {
        data.byId = new Map(data.settlements.map(s => [s.id, s]));
        data.byName = new Map(data.settlements.map(s => [tradeName(s.name), s]));
        data.goodsById = new Map([...data.goods, ...data.signature_goods].map(g => [g.id, g]));
        data.housesById = new Map(data.houses.map(h => [h.id, h]));
        return data;
      });
      this.loads.set(world, work);
      work.catch(() => { if (this.loads.get(world) === work) this.loads.delete(world); });
    }
    return this.loads.get(world);
  }
  profile(data, place, id) {
    if (id !== undefined) return data.byId?.get(id) ?? null;
    return data.byId?.get(data.matches?.[place.id]) ?? [place.original, place.name].filter(Boolean).map(n => data.byName?.get(tradeName(n))).find(Boolean) ?? null;
  }
  row(data, profile, id, group = "exports") {
    const g = data.goodsById?.get(id); if (!g) return null;
    const signature = g.origin_gp != null;
    const mod = signature ? g.mod?.[profile?.id] : profile?.price_mod?.[id];
    return { key: `${group}-${id}`, good: id, name: g.name, unit: g.unit, cat: g.cat ?? "Specialty", base: signature ? g.origin_gp : g.base, mod: mod ?? 1, group,
      availability: (signature ? g.availability?.[profile?.id] : profile?.availability?.[id]) ?? "Stocked", supplier: signature ? g.origin_name : profile?.supplier?.[id] ?? "", desc: g.desc ?? "", source: signature ? "Homebrew specialty (supplied data)" : "" };
  }
  defaults(data, profile) {
    if (!profile) return { profile: "", rows: [], houses: [] };
    const rows = [];
    for (const group of ["exports", "imports"]) for (const e of profile[group] ?? []) {
      const row = this.row(data, profile, e.good, group);
      if (row) rows.push({ ...row, source: `Source tag: ${data.tags[e.tag] ?? e.tag} (supplied data)` });
    }
    for (const id of profile.signature ?? []) { const row = this.row(data, profile, id, "specialties"); if (row) rows.push(row); }
    return { profile: profile.id, rows, houses: (profile.houses ?? []).map(id => data.housesById?.get(id)?.name).filter(Boolean) };
  }
  async get(world, place) {
    const data = await this.data(world), mine = this.getEdits?.(world)?.[place.id] ?? null, own = mine ?? data.edits?.[place.id] ?? null;
    const market = own ? cleanTrade(own) : this.defaults(data, this.profile(data, place));
    return { ...market, scale: economyScale(this.getScale?.()), revision: JSON.stringify(mine), overridden: !!own, data };
  }
  async save(world, id, value, revision) {
    if (!game.user.isGM) throw Error("Only a GM can edit trade.");
    return this.saveEdits(world, id, value == null ? null : cleanTrade(value), revision);
  }
}
