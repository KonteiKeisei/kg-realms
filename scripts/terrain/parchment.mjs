/** Geography corrections are registered to the high-resolution reference during the build. */
import { CORRECTIONS } from './parchment-geography.mjs';
export function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
  }
  return inside;
}
export function northernTerrain(lon, lat) {
  if (lat < 52) return null;
  const p = [lon, lat];
  if (inRing(p, CORRECTIONS.ice)) return 'ice';
  if (CORRECTIONS.lakes.some(r => inRing(p, r))) return 'lake';
  if (inRing(p, CORRECTIONS.tundra)) return 'tundra';
  return null;
}
/** Transparent foothills blend into parchment, higher rock becomes grey and summits white. */
export function mountainTint(height) {
  const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t); };
  const alpha = smooth(450, 1800, height), snow = smooth(2400, 4200, height);
  return [Math.round(143+104*snow),Math.round(148+100*snow),Math.round(149+100*snow),Math.round(235*alpha)];
}
export function tundraWeight(lon,lat) {
  if(lat<52 || !inRing([lon,lat],CORRECTIONS.tundra))return 0;
  let distance=Infinity;
  const r=CORRECTIONS.tundra;
  for(let i=0;i<r.length-1;i++){
    const a=[(r[i][0]-lon)*66,(r[i][1]-lat)*111],b=[(r[i+1][0]-lon)*66,(r[i+1][1]-lat)*111];
    const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));
    distance=Math.min(distance,Math.hypot(a[0]+t*dx,a[1]+t*dy));
  }
  const t=Math.min(1,distance/18);return t*t*(3-2*t);
}
