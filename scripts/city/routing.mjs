// Settlement roads use scene pixels. Route distance follows the scene's configured grid scale.
export const ROAD_TYPES = {avenue:'Avenue',street:'Street',lane:'Lane',alley:'Alley'};
export const CARRIAGE_ROADS = new Set(['avenue','street']);
export const CITY_SPEEDS = {walk:3,carriage:6}; // Miles per hour.
export function cityDuration(value){const seconds=Math.max(0,Math.ceil(value)),minutes=Math.floor(seconds/60),rest=seconds%60;return minutes?`${minutes} min${rest?` ${rest} sec`:''}`:`${rest} sec`;}
export const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const point = p => Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000000);
export function validateRoads(data) {
  if(data?.schema!==1||!Array.isArray(data.roads)||data.roads.length>5000)throw Error('Invalid settlement roads export.');
  let count=0;const ids=new Set();
  for(const r of data.roads){
    if(typeof r.id!=='string'||!r.id||ids.has(r.id)||!ROAD_TYPES[r.kind]||typeof r.name!=='string'||r.name.length>200||!Array.isArray(r.points)||r.points.length<2||!r.points.every(point))throw Error('A road has invalid geometry or category.');
    ids.add(r.id);count+=r.points.length;
  }
  if(count>50000)throw Error('Too many road points in this export.');
  return data;
}
export function project(p,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
  const t=len?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)):0;
  const at=[a[0]+dx*t,a[1]+dy*t];return{t,point:at,distance:distance(at,p)};
}
/**
 * Join road b onto road a end to end, by their nearest ends: a's points, then b's, as one line.
 * Ends closer than a pixel become one point. Returns { points, gap } (gap in scene pixels).
 */
export function joinRoads(a,b) {
  let best=null;
  for(const x of [a,[...a].reverse()])for(const y of [b,[...b].reverse()]){
    const gap=distance(x.at(-1),y[0]);
    if(!best||gap<best.gap)best={gap,points:gap<1?[...x,...y.slice(1)]:[...x,...y]};
  }
  return best;
}
function crossing(a,b,c,d) {
  const rx=b[0]-a[0],ry=b[1]-a[1],sx=d[0]-c[0],sy=d[1]-c[1],den=rx*sy-ry*sx;
  if(Math.abs(den)<1e-9)return null;
  const qx=c[0]-a[0],qy=c[1]-a[1],t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;
  return t>=0&&t<=1&&u>=0&&u<=1?{t,u}:null;
}
class Heap {
  items=[];
  push(item){let i=this.items.length;this.items.push(item);while(i){const p=(i-1)>>1;if(this.items[p].cost<=item.cost)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
  pop(){const top=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let c=i*2+1;if(c+1<this.items.length&&this.items[c+1].cost<this.items[c].cost)c++;if(this.items[c].cost>=last.cost)break;this.items[i]=this.items[c];i=c;}this.items[i]=last;}return top;}
}
export function buildCityGraph(data,{snap=8,cell=512}={}) {
  validateRoads(data);const segments=[];
  for(const road of data.roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i];if(distance(a,b)>.01)segments.push({a,b,road,cuts:[0,1]});}
  // Spatial buckets keep junction work local, rather than comparing every pair of city segments.
  const bins=new Map(),pairs=new Set();
  for(let i=0;i<segments.length;i++){
    const s=segments[i],a=s.a,b=s.b;
    const cells=(Math.floor(Math.abs(a[0]-b[0])/cell)+2)*(Math.floor(Math.abs(a[1]-b[1])/cell)+2);
    if(cells>10000)throw Error('A road segment spans too much of the map. Add intermediate points.');
    for(let x=Math.floor((Math.min(a[0],b[0])-snap)/cell);x<=Math.floor((Math.max(a[0],b[0])+snap)/cell);x++)for(let y=Math.floor((Math.min(a[1],b[1])-snap)/cell);y<=Math.floor((Math.max(a[1],b[1])+snap)/cell);y++){
      const key=`${x},${y}`,list=bins.get(key)??[];
      for(const j of list){const pair=`${j}:${i}`;if(pairs.has(pair))continue;pairs.add(pair);if(pairs.size>1000000)throw Error('Too many overlapping road segments. Remove duplicate roads before routing.');const t=segments[j],hit=crossing(s.a,s.b,t.a,t.b);
        if(hit){s.cuts.push(hit.t);t.cuts.push(hit.u);}
        for(const p of [s.a,s.b]){const q=project(p,t.a,t.b);if(q.distance<=snap)t.cuts.push(q.t);}
        for(const p of [t.a,t.b]){const q=project(p,s.a,s.b);if(q.distance<=snap)s.cuts.push(q.t);}
      }
      list.push(i);bins.set(key,list);
    }
  }
  return{segments,snap,revision:data.revision??0};
}
function nearest(p,segments){let best=null;for(let i=0;i<segments.length;i++){const q=project(p,segments[i].a,segments[i].b);if(!best||q.distance<best.distance)best={...q,index:i};}return best;}
export function planCityRoute(graph,start,end,{mode='walk',feetPerPixel=1,speeds=CITY_SPEEDS,maxConnector=300}={}) {
  if(!point(start)||!point(end)||!Number.isFinite(feetPerPixel)||feetPerPixel<=0)throw Error('The party position or map distance scale is invalid.');
  if(!['walk','mixed'].includes(mode))throw Error('Choose walking or carriage with walking connections.');
  if(![speeds.walk,speeds.carriage].every(s=>Number.isFinite(s)&&s>0))throw Error('Travel speeds must be greater than zero.');
  if(distance(start,end)<.1)throw Error('The party is already at that destination.');
  const origin=nearest(start,graph.segments),destination=nearest(end,graph.segments);
  if(!origin)throw Error('Draw settlement roads before planning travel.');
  if(origin.distance>maxConnector||destination.distance>maxConnector)throw Error('The party or destination is too far from a road. Extend the road network to reach it.');
  const nodes=[],buckets=new Map(),snap=Math.max(.01,graph.snap),edges=[];
  function node(at){const gx=Math.floor(at[0]/snap),gy=Math.floor(at[1]/snap);
    for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(const id of buckets.get(`${x},${y}`)??[])if(distance(nodes[id],at)<=snap)return id;
    const id=nodes.length;nodes.push(at);edges.push([]);const key=`${gx},${gy}`;buckets.set(key,[...(buckets.get(key)??[]),id]);return id;
  }
  let from,to;
  for(const [index,s] of graph.segments.entries()){
    const cuts=[...s.cuts];if(index===origin.index)cuts.push(origin.t);if(index===destination.index)cuts.push(destination.t);
    const order=[...new Set(cuts)].sort((a,b)=>a-b),ids=order.map(t=>node([s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t]));
    if(index===origin.index)from=ids[order.indexOf(origin.t)];if(index===destination.index)to=ids[order.indexOf(destination.t)];
    for(let i=1;i<ids.length;i++){const a=ids[i-1],b=ids[i];if(a===b)continue;const length=distance(nodes[a],nodes[b]);edges[a].push({to:b,length,road:s.road});edges[b].push({to:a,length,road:s.road});}
  }
  const startKey=`${from}:walk`,best=new Map([[startKey,0]]),previous=new Map(),heap=new Heap();heap.push({node:from,mode:'walk',cost:0,key:startKey});let target;
  while(heap.items.length){const current=heap.pop();if(current.cost!==best.get(current.key))continue;if(current.node===to){target=current.key;break;}
    for(const edge of edges[current.node])for(const travel of mode==='mixed'&&CARRIAGE_ROADS.has(edge.road.kind)?['walk','carriage']:['walk']){
      const seconds=edge.length*feetPerPixel/(speeds[travel]*5280/3600),boarding=travel==='carriage'&&current.mode!=='carriage';
      // Alley preference affects route choice, never the elapsed clock. A tiny tie-break avoids redundant boardings.
      const cost=current.cost+seconds*(travel==='walk'&&edge.road.kind==='alley'?1.4:1)+(boarding ? .01 : 0),key=`${edge.to}:${travel}`;
      if(cost>=(best.get(key)??Infinity))continue;best.set(key,cost);previous.set(key,{key:current.key,from:current.node,to:edge.to,mode:travel,seconds,road:edge.road});heap.push({node:edge.to,mode:travel,cost,key});
    }
  }
  if(!target)throw Error('Those roads do not connect. Join their endpoints or add a connecting road.');
  const steps=[];for(let k=target;k!==startKey;){const p=previous.get(k);steps.push({from:nodes[p.from],to:nodes[p.to],mode:p.mode,seconds:p.seconds,road:p.road});k=p.key;}steps.reverse();
  const walking=(a,b)=>({from:a,to:b,mode:'walk',seconds:distance(a,b)*feetPerPixel/(speeds.walk*5280/3600),road:{id:'access',name:'Walking connection',kind:'lane'}});
  if(distance(start,nodes[from])>.01)steps.unshift(walking(start,nodes[from]));
  if(distance(nodes[to],end)>.01)steps.push(walking(nodes[to],end));
  const legs=[];
  for(const step of steps){let leg=legs.at(-1);if(!leg||leg.mode!==step.mode){leg={mode:step.mode,seconds:0,points:[step.from],roads:[]};legs.push(leg);}leg.seconds+=step.seconds;leg.points.push(step.to);if(leg.roads.at(-1)!==step.road.name)leg.roads.push(step.road.name);}
  const seconds=legs.reduce((n,l)=>n+l.seconds,0),feet=steps.reduce((n,s)=>n+distance(s.from,s.to)*feetPerPixel,0);
  return{start:[...start],end:[...end],legs,seconds,feet,boardingCount:legs.filter(l=>l.mode==='carriage').length,roadRevision:graph.revision};
}
/** The nearest point on the roads to p, or null when there are no roads: { point, distance }. */
export function snapToRoad(graph,p){const q=nearest(p,graph.segments);if(!q)return null;const s=graph.segments[q.index];return{point:[s.a[0]+(s.b[0]-s.a[0])*q.t,s.a[1]+(s.b[1]-s.a[1])*q.t],distance:q.distance};}
/**
 * One trip from routes planned piece by piece (the party, the points it goes by, the destination):
 * a leg that carries on in the same way joins the one before, so a carriage is not boarded again
 * at a route point.
 */
export function joinCityPlans(parts){
  if(parts.length===1)return parts[0];const legs=[];
  for(const part of parts)for(const leg of part.legs){const last=legs.at(-1);
    if(last&&last.mode===leg.mode){last.seconds+=leg.seconds;last.points.push(...leg.points.slice(1));for(const r of leg.roads)if(last.roads.at(-1)!==r)last.roads.push(r);}
    else legs.push({...leg,points:[...leg.points],roads:[...leg.roads]});}
  return{start:[...parts[0].start],end:[...parts.at(-1).end],legs,seconds:parts.reduce((n,p)=>n+p.seconds,0),feet:parts.reduce((n,p)=>n+p.feet,0),boardingCount:legs.filter(l=>l.mode==='carriage').length,roadRevision:parts[0].roadRevision};
}
export function cityPosition(plan,elapsed) {
  let at=Math.max(0,elapsed);
  for(const [index,leg]of plan.legs.entries()){
    if(at<=leg.seconds||index===plan.legs.length-1){let length=0;for(let i=1;i<leg.points.length;i++)length+=distance(leg.points[i-1],leg.points[i]);let remaining=length*Math.min(1,at/Math.max(.001,leg.seconds));
      for(let i=1;i<leg.points.length;i++){const a=leg.points[i-1],b=leg.points[i],len=distance(a,b);if(remaining<=len||i===leg.points.length-1){const t=len?Math.min(1,remaining/len):1;return{point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],mode:leg.mode,leg:index};}remaining-=len;}
    }at-=leg.seconds;
  }return{point:plan.end,mode:'walk',leg:plan.legs.length-1};
}
export function boardedCoaches(plan,elapsed){let at=0,count=0;for(const leg of plan.legs){if(leg.mode==='carriage'&&elapsed>=at)count++;at+=leg.seconds;}return count;}
