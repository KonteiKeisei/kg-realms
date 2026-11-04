const digest=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const decode=bytes=>createImageBitmap(new Blob([bytes]));
function pixels(bitmap,width,height){const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);return ctx.getImageData(0,0,width,height).data;}

/** Previews are ordinary images: hosts can re-encode them. The KTX2 detail files stay byte-exact. */
export async function verifyTilePreview(original,stored,io={}){
  const [a,b]=await Promise.all([digest(original),digest(stored)]);
  if(a.every((n,i)=>n===b[i]))return;
  let expected,actual;
  try{
    expected=await(io.decode??decode)(original);actual=await(io.decode??decode)(stored);
    const w=expected.width,h=expected.height;
    if(!actual.width||!actual.height||Math.max(actual.width,actual.height)>1024||Math.abs(w*actual.height-h*actual.width)>Math.max(w*actual.height,h*actual.width)*.02+.5)throw Error('The saved tile preview has a different shape or is too large.');
    const source=(io.pixels??pixels)(expected,w,h),saved=(io.pixels??pixels)(actual,w,h);
    let alphaError=0,colorError=0,colorSamples=0;
    for(let i=0;i<source.length;i+=4){
      const alpha=source[i+3],other=saved[i+3];alphaError+=Math.abs(alpha-other);
      if(alpha<=16&&other>=96)throw Error('The server removed transparency from a tile preview. Keep transparency enabled in image upload processing.');
      if(alpha>=128&&other>=128){for(let c=0;c<3;c++)colorError+=Math.abs(source[i+c]-saved[i+c]);colorSamples+=3;}
    }
    if(alphaError/(w*h)>12||colorError/Math.max(1,colorSamples)>40)throw Error('The saved tile preview does not match its source image.');
  }catch(error){if(!expected||!actual)throw Error('The saved tile preview could not be decoded as an image.',{cause:error});throw error;}
  finally{expected?.close();actual?.close();}
}
