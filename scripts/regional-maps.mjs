// Regional maps use their own metric while their geometry is projected onto a parent sheet.
// Coordinates in links are sheet pixels, except footprint and POI positions (lon/lat).
import { pointInBiome } from './biomes.mjs';
import { sourceProjection } from './source-map.mjs';

const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
export const mixPoint = (a,b,t) => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
/** Follow a bearing for true miles, including when an escape crosses a regional border. */
export function regionalPointAtDistance(from,bearing,miles,segments,milesPerPixel){
  const at=r=>[from[0]+Math.cos(bearing)*r,from[1]+Math.sin(bearing)*r],distance=r=>segments(from,at(r)).reduce((n,s)=>n+s.miles,0);
  let lo=0,hi=miles/milesPerPixel;
  for(let i=0;i<32&&distance(hi)<miles;i++)hi*=2;
  if(distance(hi)<miles)throw Error('Could not measure the requested regional distance.');
  for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(distance(mid)<miles)lo=mid;else hi=mid;}
  return at((lo+hi)/2);
}
export function affine(anchors) {
  if (!Array.isArray(anchors) || anchors.length !== 3 || !anchors.every(a=>point(a.parent)&&point(a.region))) throw Error('Match three landmarks on both maps.');
  const build = (from,to) => {
    const [a,b,c]=from, u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-a[0],c[1]-a[1]],d=u[0]*v[1]-u[1]*v[0];
    if(Math.abs(d)<1e-6)throw Error('The three alignment points must form a triangle on each map.');
    return p=>{const x=p[0]-a[0],y=p[1]-a[1],s=(x*v[1]-y*v[0])/d,t=(u[0]*y-u[1]*x)/d;return [to[0][0]+s*(to[1][0]-to[0][0])+t*(to[2][0]-to[0][0]),to[0][1]+s*(to[1][1]-to[0][1])+t*(to[2][1]-to[0][1])];};
  };
  return {toRegion:build(anchors.map(a=>a.parent),anchors.map(a=>a.region)),toParent:build(anchors.map(a=>a.region),anchors.map(a=>a.parent))};
}
export function segmentCuts(a,b,polygon) {
  const cuts=[0,1],dx=b[0]-a[0],dy=b[1]-a[1];
  for(let i=0;i<polygon.length;i++){
    const c=polygon[i],d=polygon[(i+1)%polygon.length],ex=d[0]-c[0],ey=d[1]-c[1],den=dx*ey-dy*ex;
    if(Math.abs(den)<1e-10)continue;
    const x=c[0]-a[0],y=c[1]-a[1],t=(x*ey-y*ex)/den,u=(x*dy-y*dx)/den;
    if(t>1e-9&&t<1-1e-9&&u>=-1e-9&&u<=1+1e-9)cuts.push(t);
  }
  return [...new Set(cuts.map(t=>Math.round(t*1e10)/1e10))].sort((x,y)=>x-y);
}
export function compileRegions(parent, children) {
  const root=sourceProjection(parent.sourceMap);
  const regions=children.map(({link,data,terrainAt})=>{
    if(!data?.sourceMap||!Number.isFinite(data.sourceMap.milesPerPixel)||data.sourceMap.milesPerPixel<=0)throw Error(`${link.title}: set a positive regional map scale first.`);
    if(!Array.isArray(link.footprint)||link.footprint.length<3||!link.footprint.every(point))throw Error('A regional map needs a closed parent outline.');
    const projection=sourceProjection(data.sourceMap),transform=affine(link.anchors),polygon=link.footprint.map(p=>root.toSource(...p));
    const area=polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0);
    if(Math.abs(area)<1e-6)throw Error(`${link.title}: the regional outline has no area.`);
    for(const p of polygon){const q=transform.toRegion(p);if(q[0]<-1||q[1]<-1||q[0]>data.sourceMap.width+1||q[1]>data.sourceMap.height+1)throw Error(`${link.title}: the outline extends outside the aligned regional picture.`);}
    const origin=transform.toRegion([0,0]),x=transform.toRegion([1,0]),y=transform.toRegion([0,1]),resolution=1/Math.max(1,Math.hypot(x[0]-origin[0],x[1]-origin[1]),Math.hypot(y[0]-origin[0],y[1]-origin[1]));
    return {...link,projection,...transform,polygon,terrainAt,data,resolution};
  });
  // Ambiguous ownership must never depend on setting insertion order.
  for(let i=0;i<regions.length;i++)for(let j=0;j<i;j++){
    const a=regions[i].polygon,b=regions[j].polygon;
    if(a.some(p=>pointInBiome(p,b))||b.some(p=>pointInBiome(p,a))||a.some((p,k)=>segmentCuts(p,a[(k+1)%a.length],b).length>2))throw Error('Regional outlines overlap. Adjust them so each location has one owner.');
  }
  const owner=p=>regions.find(r=>pointInBiome(p,r.polygon));
  const segments=(a,b)=>{
    const cuts=[...new Set([0,1,...regions.flatMap(r=>segmentCuts(a,b,r.polygon))])].sort((x,y)=>x-y),out=[];
    for(let i=1;i<cuts.length;i++){
      const from=mixPoint(a,b,cuts[i-1]),to=mixPoint(a,b,cuts[i]),r=owner(mixPoint(from,to,.5)),nativeA=r?r.toRegion(from):from,nativeB=r?r.toRegion(to):to;
      out.push({from,to,miles:Math.hypot(nativeB[0]-nativeA[0],nativeB[1]-nativeA[1])*(r?.data.sourceMap.milesPerPixel??root.sourceMap.milesPerPixel),worldId:r?.world??parent.id,regionTitle:r?.title,nativeFrom:nativeA,nativeTo:nativeB});
    }return out;
  };
  const terrainAt=(fallback)=>(x,y)=>{const r=owner([x,y]);return r?r.terrainAt(...r.toRegion([x,y])):fallback(x,y);};
  // Parent roads inside a region are superseded. Only regional roads inside its footprint survive.
  const roads=(parentRoutes, childRoutes)=>{
    const features=[];
    const add=(collection,r)=>{for(const f of collection?.features??[]){
      if(f.geometry?.type!=='LineString')continue;
      const pts=f.geometry.coordinates.map(p=>r?r.toParent(r.projection.toSource(...p)):root.toSource(...p));let run=[];
      const flush=()=>{if(run.length>1)features.push({type:'Feature',properties:{...f.properties,regionalResolution:r?.resolution??1,id:`${r?.world??parent.id}:${f.properties?.id??'road'}:${features.length}`},geometry:{type:'LineString',coordinates:run.map(q=>root.toLonLat(...q))}});run=[];};
      for(let i=1;i<pts.length;i++)for(const s of segments(pts[i-1],pts[i])){const own=owner(mixPoint(s.from,s.to,.5));if((r&&own!==r)||(!r&&own)){flush();continue;}if(!run.length)run.push(s.from);run.push(s.to);}flush();
    }};
    add(parentRoutes,null);for(const r of regions)add(childRoutes[r.world],r);return {type:'FeatureCollection',features};
  };
  return {root,regions,owner,segments,terrainAt,roads};
}

/** One canonical place, with separately editable positions on each map. */
export function regionalPlaces(world,raw,links,indexes) {
  const out=[...(raw(world)??[])],own=links[world];
  const transfer=(p,from,to,transform,extra={})=>{
    const q={...p,...extra,lon:transform[0],lat:transform[1],canonicalWorld:p.canonicalWorld??from,canonicalId:p.canonicalId??p.id};
    // Area geometry belongs to the source map, never reuse it in another projection.
    for(const k of ['area','shape','follow','shore','biomeZone'])delete q[k];return q;
  };
  if(own&&indexes[own.parent]&&indexes[world]){
    const a=sourceProjection(indexes[own.parent].sourceMap),b=sourceProjection(indexes[world].sourceMap),t=affine(own.anchors);
    const ids=new Set(out.map(p=>p.id));
    for(const p of raw(own.parent)??[])if(pointInBiome([p.lon,p.lat],own.footprint)&&!ids.has(p.id))out.push(transfer(p,own.parent,world,own.positions?.[p.id]??b.toLonLat(...t.toRegion(a.toSource(p.lon,p.lat)))));
  }
  for(const link of Object.values(links).filter(l=>l.parent===world)){
    if(!indexes[link.world]||!indexes[world])continue;
    const a=sourceProjection(indexes[world].sourceMap),b=sourceProjection(indexes[link.world].sourceMap),t=affine(link.anchors);
    for(const p of raw(link.world)??[]){if(!(link.publish??[]).includes(p.id)||out.some(q=>q.id===p.id))continue;const at=a.toLonLat(...t.toParent(b.toSource(p.lon,p.lat)));if(pointInBiome(at,link.footprint))out.push(transfer(p,link.world,world,at,{regionalWorld:link.world,approximate:true}));}
  }
  return out;
}
