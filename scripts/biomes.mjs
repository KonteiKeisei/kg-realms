import { TERRAIN } from "./travel.mjs";

export const BIOME_FIELDS = {
  offroad: { label: "Off-road speed", min: .1, max: 4, step: .05, unit: "x terrain speed" },
  road: { label: "Road speed", min: .1, max: 4, step: .05, unit: "x road speed" },
  trail: { label: "Trail speed", min: .1, max: 4, step: .05, unit: "x trail speed" },
  forage: { label: "Forage DC", min: 0, max: 40, step: 1 },
  conceal: { label: "Conceal DC", min: 0, max: 40, step: 1 },
  alarm: { label: "Alarms DC", min: 0, max: 40, step: 1 }
};
const preset = (name, terrain, forage, color) => ({ name, terrain, forage, conceal: 10, alarm: 12, offroad: 1, road: 1, trail: 1, color });
export const DEFAULT_BIOMES = {
  plains: { ...preset("Plains", 1, 10, "#c7b775"), priority:10, offroad:.8, trail:.9 },
  forest: { ...preset("Forest", 2, 15, "#438253"), priority:5, offroad:.4, road:.9, trail:.6 },
  desert: { ...preset("Desert", 6, 25, "#d5aa62"), priority:8, offroad:.45, road:.9, trail:.65, conceal:15 },
  tundra: { ...preset("Tundra", 7, 20, "#a8b7ac"), priority:7, offroad:.4, road:.9, trail:.65, conceal:15 },
  taiga: { ...preset("Taiga", 2, 15, "#427a76"), priority:6, offroad:.35, road:.85, trail:.55, conceal:12 },
  hills: { ...preset("Hills", 3, 15, "#a48b65"), priority:2, offroad:.5, road:.9, trail:.7, alarm:10 },
  wetlands: { ...preset("Wetlands", 5, 15, "#699489"), priority:3, offroad:.3, road:.8, trail:.5, conceal:15, alarm:15 },
  mountains: { ...preset("Mountains", 4, 20, "#8c8a91"), priority:1, offroad:.2, road:.7, trail:.3, conceal:20 },
  glacier: { ...preset("Glacier", 7, 25, "#b1d8e5"), priority:4, offroad:.15, road:.6, trail:.25, conceal:20, alarm:15 }
};
const FALLBACK = { 1: "plains", 2: "forest", 3: "hills", 4: "mountains", 5: "wetlands", 6: "desert", 7: "glacier", 9: "plains" };
const TERRAIN_CODES = new Map(Object.entries(TERRAIN).map(([code, value]) => [value.name, code]));
const clean = (values = {}) => {
  if (!values || typeof values !== "object") return {};
  const out = {};
  for (const [key, f] of Object.entries(BIOME_FIELDS)) if (values[key] !== "" && values[key] != null && Number.isFinite(Number(values[key]))) out[key] = Math.max(f.min, Math.min(f.max, Number(values[key])));
  return out;
};
export function biomeTypes(config = {}) {
  const out = Object.create(null);
  for (const [id, base] of Object.entries({ ...DEFAULT_BIOMES, ...(config.types ?? {}) })) {
    const own = config.types?.[id] ?? {}, def = DEFAULT_BIOMES[id] ?? DEFAULT_BIOMES.plains;
    const fields=clean({...base,...own});for(const k of Object.keys(BIOME_FIELDS))fields[k]??=def[k];
    const requested=Number(own.priority??base.priority??def.priority),priority=Number.isFinite(requested)&&requested>=0&&(!DEFAULT_BIOMES[id]||requested>0)?Math.min(1000,requested):def.priority;
    out[id] = { ...fields, priority, name: String(own.name || base.name || def.name || id).slice(0, 100), terrain: TERRAIN[Number(own.terrain ?? base.terrain)] && Number(own.terrain ?? base.terrain) !== 8 ? Number(own.terrain ?? base.terrain) : def.terrain,
      color: /^#[0-9a-f]{6}$/i.test(own.color ?? base.color) ? own.color ?? base.color : def.color };
  }
  return out;
}
export function biomeZone(zone, types) {
  const type = types[zone?.type] ? zone.type : "plains", base = types[type] ?? DEFAULT_BIOMES.plains;
  return { ...base, ...clean(zone?.overrides), type, zoneId: zone?.id ?? null, name: String(zone?.name || base.name).slice(0, 200) };
}
export function biomePriority(zone,types){const n=Number(zone.priority),base=types[zone.type]?.priority??10;return zone.priority!=null&&zone.priority!==""&&Number.isFinite(n)&&n>=0&&(!DEFAULT_BIOMES[zone.type]||n>0)?Math.min(1000,n):base;}
export function mergeBiomeConfig(shipped={},own={}){const out={types:{...shipped.types},zones:{...shipped.zones}};for(const key of ["types","zones"])for(const[id,value]of Object.entries(own[key]??{})){if(value==null)delete out[key][id];else out[key][id]=value;}return out;}
export function biomeEdits(shipped={},next={}){const out={types:{},zones:{}};for(const key of ["types","zones"]){for(const[id,value]of Object.entries(next[key]??{}))if(JSON.stringify(value)!==JSON.stringify(shipped[key]?.[id]))out[key][id]=value;for(const id of Object.keys(shipped[key]??{}))if(!(id in(next[key]??{})))out[key][id]=null;}return out;}
/** Existing journeys keep their earlier defaults; new journeys freeze all resolved type fields. */
export function freezeBiomeTravel(config={},legacy=false){
  const types=legacy?Object.fromEntries(Object.entries(DEFAULT_BIOMES).map(([id,t])=>[id,{...t,offroad:1,road:1,trail:1,...config.types?.[id]}])):biomeTypes(config);
  if(legacy)for(const[id,t]of Object.entries(config.types??{}))if(!types[id])types[id]=t;
  return{version:legacy?1:2,legacyPriority:legacy,types:structuredClone({...types}),zones:structuredClone(config.zones??{})};
}
export function pointInBiome([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    if (Math.abs((x-ax)*(by-ay)-(y-ay)*(bx-ax)) < 1e-7 && x >= Math.min(ax,bx)-1e-7 && x <= Math.max(ax,bx)+1e-7 && y >= Math.min(ay,by)-1e-7 && y <= Math.max(ay,by)+1e-7) return true;
    if ((ay > y) !== (by > y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside = !inside;
  }
  return inside;
}

/** Compile polygons once. A query checks only the nearby buckets, then the terrain-map fallback. */
export function biomeLookup(config = {}, terrainAt = () => TERRAIN[1], project = (x,y) => [x,y], {legacyPriority=false}={}) {
  const types = biomeTypes(config), buckets = new Map(), global = [], cell = 256;
  for (const [id, z] of Object.entries(config.zones ?? {})) {
    if (!z || z.disabled || !Array.isArray(z.pts) || z.pts.length < 3 || z.pts.length>10000 || !z.pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) continue;
    const pts = z.pts.map((p) => project(...p));
    if (!pts.every(p => p?.length === 2 && p.every(Number.isFinite))) continue;
    const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const area = Math.abs(pts.reduce((sum,p,i)=>{const q=pts[(i+1)%pts.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
    if (area < 1e-9) continue;
    const holes = (Array.isArray(z.holes) ? z.holes : []).filter(r => Array.isArray(r) && r.length >= 3 && r.length <= 10000 && r.every(p => p?.length === 2 && p.every(Number.isFinite))).map(r => r.map(p => project(...p))).filter(r => r.every(p => p?.length === 2 && p.every(Number.isFinite)));
    const entry = { id, pts, holes, minX, maxX, minY, maxY, area, priority: legacyPriority?(Number(z.priority)||0):biomePriority(z,types), biome: biomeZone({ ...z, id }, types) };
    const x0=Math.floor(minX/cell),x1=Math.floor(maxX/cell),y0=Math.floor(minY/cell),y1=Math.floor(maxY/cell);
    if ((x1-x0+1)*(y1-y0+1)>4096) global.push(entry);
    else for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const k=`${x},${y}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(entry);}
  }
  const order = (a,b)=> (legacyPriority?b.priority-a.priority:a.priority-b.priority) || a.area-b.area || a.id.localeCompare(b.id);
  for (const a of buckets.values()) a.sort(order);global.sort(order);
  const query = (x,y,terrain) => {
    if(terrain.water)return null;
    const contains=z=>x>=z.minX&&x<=z.maxX&&y>=z.minY&&y<=z.maxY&&pointInBiome([x,y],z.pts)&&!z.holes.some(r=>pointInBiome([x,y],r));
    const local=(buckets.get(`${Math.floor(x/cell)},${Math.floor(y/cell)}`)??[]).find(contains),wide=global.find(contains);
    const match=!local?wide:!wide?local:order(local,wide)<=0?local:wide;
    if(match)return match.biome;
    const type=FALLBACK[TERRAIN_CODES.get(terrain.name)]??"plains";
    return biomeZone({type},types);
  };
  const at=(x,y)=>query(x,y,terrainAt(x,y));
  at.terrain = (x,y) => { const original=terrainAt(x,y),b=query(x,y,original);return b?{...original,...TERRAIN[b.terrain],biome:b}:original; };
  return at;
}

/** Biome replication alone cannot change movement speed. Effects reacting to it still can. */
export function onlyBiomeFlagChanged(changes) {
  const paths=[];
  const visit=(value,path="")=>{for(const [key,item] of Object.entries(value??{})){const next=path?`${path}.${key}`:key;if(item&&typeof item==="object"&&!Array.isArray(item)&&Object.keys(item).length)visit(item,next);else paths.push(next);}};
  visit(changes);
  return paths.length>0&&paths.every(p=>p==="flags.kg-realms.biome"||p.startsWith("flags.kg-realms.biome."));
}

export function biomeFlag(biome, { world, scene } = {}) {
  return biome ? { world, scene, zoneId: biome.zoneId, type: biome.type, name: biome.name,
    travel: { offroad: biome.offroad, road: biome.road, trail: biome.trail }, dc: { forage: biome.forage, conceal: biome.conceal, alarm: biome.alarm } } : null;
}

/** Called by the primary GM after a map-position update. No actor writes for unchanged biomes. */
export async function syncPartyBiome(actors, value, valid = () => true) {
  const changed = actors.filter(a=>JSON.stringify(a.getFlag?.("kg-realms","biome")??a.flags?.["kg-realms"]?.biome??null)!==JSON.stringify(value));
  if(changed.length&&globalThis.Actor?.updateDocuments&&changed.every(a=>!a.isToken)){
    if(!valid())return;
    const previous=changed.map(a=>a.getFlag?.("kg-realms","biome")??a.flags?.["kg-realms"]?.biome??null);
    await Actor.updateDocuments(changed.map(a=>({_id:a.id,"flags.kg-realms.biome":value})));
    changed.forEach((a,i)=>globalThis.Hooks?.callAll("kgRealmsBiomeChanged",a,value,previous[i]));return;
  }
  for(const actor of changed){
    if(!valid())return;
    const before=actor.getFlag?.("kg-realms","biome")??actor.flags?.["kg-realms"]?.biome??null;
    await actor.update({"flags.kg-realms.biome":value});
    globalThis.Hooks?.callAll("kgRealmsBiomeChanged",actor,value,before);
  }
}
