// Hit areas follow the printed text, including rotated and multiline labels.
const inside=(x,y,p)=>{let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const segmentDistance=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);};
export function labelHitIndex(features){
 const cells=new Map(),size=256;
 for(const f of features){const p=f.properties;for(const polygon of p.labelPolygons??[]){
  const xs=polygon.map(v=>v[0]),ys=polygon.map(v=>v[1]),box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  const item={id:p.id,hidden:p.hidden,polygon,area:(box[2]-box[0])*(box[3]-box[1])};
  for(let y=Math.floor(box[1]/size);y<=Math.floor(box[3]/size);y++)for(let x=Math.floor(box[0]/size);x<=Math.floor(box[2]/size);x++){const key=`${x},${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);}
 }}
 return (x,y,padding=0,editing=false)=>{let best=null,score=Infinity;const seen=new Set();
  for(let cy=Math.floor((y-padding)/size);cy<=Math.floor((y+padding)/size);cy++)for(let cx=Math.floor((x-padding)/size);cx<=Math.floor((x+padding)/size);cx++)for(const item of cells.get(`${cx},${cy}`)??[]){
   if(seen.has(item)||item.hidden&&!editing)continue;seen.add(item);
   const d=inside(x,y,item.polygon)?0:Math.min(...item.polygon.map((p,i)=>segmentDistance(x,y,p,item.polygon[(i+1)%item.polygon.length])));
   const s=d*1e6+item.area;if(d<=padding&&s<score){best=item.id;score=s;}
  }return best;
 };
}
