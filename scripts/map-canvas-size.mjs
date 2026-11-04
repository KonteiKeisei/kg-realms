/** Bound the requested pixels before MapLibre has to lower its drawing resolution. */
export function mapCanvasSizing([width,height],{sharp=false,devicePixelRatio=1,maxTextureSize=4096,maxRenderbufferSize=4096}={}){
  const positive=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
  const limit=Math.floor(Math.min(4096,positive(maxTextureSize,4096),positive(maxRenderbufferSize,4096)));
  const requested=sharp?Math.min(positive(devicePixelRatio,1),2):1;
  const pixelRatio=Math.min(requested,(limit-1)/Math.max(1,Math.ceil(positive(width,1)),Math.ceil(positive(height,1))));
  return{pixelRatio,maxCanvasSize:[limit,limit]};
}
