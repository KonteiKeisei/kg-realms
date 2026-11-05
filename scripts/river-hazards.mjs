export const RIVER_HAZARDS = { rapids: "Rapids", waterfall: "Waterfall" };
export const HAZARD_TYPES = { ...RIVER_HAZARDS, naval: "Naval Hazard" };
export const hazardSubtype = e => e?.kind === "hazard" ? e.subtype : HAZARD_TYPES[e?.kind] ? e.kind : null;
export const isHazard = e => e?.kind === "hazard" || !!HAZARD_TYPES[e?.kind];
export const isRiverHazard = e => !!RIVER_HAZARDS[hazardSubtype(e)];
export const isNavalHazard = e => hazardSubtype(e) === "naval";
export const hazardVisible = (e, gm = false) => gm || (isHazard(e) && (e.visibility ?? "hidden") !== "hidden");
export function hazardDefaults(kind) {
  return { kind:"hazard", subtype:kind, name:HAZARD_TYPES[kind]??"Hazard", permanent:true, autoDiscover:true, visibility:"hidden", dc:13, radius:.5, notes:"" };
}
export function normalizeEncounter(e){if(!e)return e;return HAZARD_TYPES[e.kind]?{...e,kind:"hazard",subtype:e.kind,permanent:true}:!e.kind?{...e,kind:"encounter"}:e;}
export function encounterFile(encounters,world){return{version:2,world,encounters:Object.fromEntries(Object.entries(encounters).map(([id,e])=>[id,normalizeEncounter(e)]))};}
export function readEncounterFile(data){const entries=data?.encounters;if(!entries||typeof entries!=="object"||Array.isArray(entries))throw Error("Choose an encounters export.");const out={};for(const[id,raw]of Object.entries(entries)){if(["__proto__","constructor","prototype"].includes(id))throw Error("Invalid encounter identifier");if(!raw||!Number.isFinite(raw.lon)||!Number.isFinite(raw.lat)||Math.abs(raw.lon)>180||Math.abs(raw.lat)>90)throw Error(`Invalid encounter position: ${id}`);const e=normalizeEncounter(raw);out[id]={...e,name:String(e.name||"Encounter").slice(0,200),group:String(e.group??"").trim().slice(0,120)};}return out;}
/** Only actual river travel encounters a river hazard, once on each distinct passage. */
export function riverHazardHours(track,e) {
  const found=[];let group=null,last=-2;
  for(let i=0;i+1<track.length;i++){
    const a=track[i],b=track[i+1];if(a.kind!=="river"||(e.river&&a.waterway!==e.river))continue;
    const dx=b.at[0]-a.at[0],dy=b.at[1]-a.at[1],l2=dx*dx+dy*dy;
    if(l2<1e-12)continue;
    const t=Math.max(0,Math.min(1,((e.at[0]-a.at[0])*dx+(e.at[1]-a.at[1])*dy)/l2));
    const distance=Math.hypot(a.at[0]+t*dx-e.at[0],a.at[1]+t*dy-e.at[1]);
    if(distance>(e.radius??15))continue;
    const hit={distance,hour:a.hour+(b.hour-a.hour)*t};
    if(i>last+1){group=hit;found.push(group);}else if(distance<group.distance)Object.assign(group,hit);
    last=i;
  }
  return found.map((p,i)=>({...e,sourceId:e.id,id:`${e.id}:river:${i+1}`,occurrence:i+1,hour:p.hour}));
}

export const SEA_HAZARD_KINDS = new Set(["sea", "wind", "lane"]);
/** A naval hazard belongs to sea travel, not a nearby land route, river journey or camp. */
export function navalHazardHours(track, e) {
  if (e.rest) return [];
  track = track.filter(p => !p.timingBoundary);
  const found = [], metric = e.nativeMetric;
  const vector = (x, y) => metric ? [metric[0]*x+metric[2]*y, metric[1]*x+metric[3]*y] : [x,y];
  let group = null, last = -2;
  for (let i = 0; i+1 < track.length; i++) {
    const a = track[i], b = track[i+1];
    if (!SEA_HAZARD_KINDS.has(a.kind) || a.portalTransfer || !a.at || !b.at || b.hour <= a.hour) continue;
    // Scheduled samples sit at interval midpoints. Use the actual sea interval so
    // tiny hazards at departure and land immediately after disembarking stay correct.
    const from = a.seaPath?.[0] ?? a.at, to = a.seaPath?.[1] ?? b.at;
    const [dx,dy] = vector(to[0]-from[0], to[1]-from[1]);
    const [ex,ey] = vector(e.at[0]-from[0], e.at[1]-from[1]);
    const length2 = dx*dx+dy*dy;
    if (length2 < 1e-12) continue;
    const t = Math.max(0,Math.min(1,(ex*dx+ey*dy)/length2));
    const distance = Math.hypot(dx*t-ex,dy*t-ey);
    if (distance > (e.radius ?? 15)) continue;
    const hit = {distance,hour:a.hour+(b.hour-a.hour)*t};
    if (i > last+1) { group=hit; found.push(group); }
    else if (distance < group.distance) Object.assign(group,hit);
    last=i;
  }
  return found.map((hit,i)=>({...e,sourceId:e.id,id:`${e.id}:naval:${i+1}`,occurrence:i+1,hour:hit.hour}));
}
