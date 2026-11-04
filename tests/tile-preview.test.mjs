import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTilePreview} from '../scripts/tile-preview.mjs';
import {mapCanvasSizing} from '../scripts/map-canvas-size.mjs';

const original=new Uint8Array([1,2,3]),reencoded=new Uint8Array([4,5,6]);
const source=new Uint8ClampedArray([10,50,70,255,0,0,0,0]);
function validation(pixels=source,dimensions=[2,1]){const closed=[];return{closed,decode:async bytes=>({width:bytes===original?2:dimensions[0],height:bytes===original?1:dimensions[1],pixels:bytes===original?source:pixels,close(){closed.push(this);}}),pixels:bitmap=>bitmap.pixels};}

test('previews permit byte changes and small colour changes while retaining image content and alpha',async()=>{
  const io=validation(new Uint8ClampedArray([14,48,73,255,2,3,1,0]));await verifyTilePreview(original,reencoded,io);assert.equal(io.closed.length,2);
  await verifyTilePreview(original,original,{decode:()=>{throw Error('Unchanged files do not need decoding');}});
});
test('preview verification rejects stripped transparency, wrong images, corrupt content and changed aspect',async()=>{
  for(const [pixels,size,message] of [[new Uint8ClampedArray([10,50,70,255,255,255,255,255]),[2,1],/transparency/],[new Uint8ClampedArray([255,255,255,255,0,0,0,0]),[2,1],/source image/],[source,[4,4],/shape/]]){
    const io=validation(pixels,size);await assert.rejects(()=>verifyTilePreview(original,reencoded,io),message);assert.equal(io.closed.length,2);
  }
  const io=validation();io.decode=async bytes=>{if(bytes===reencoded)throw Error('HTML, not an image');return{width:2,height:1,close:()=>io.closed.push(true)};};
  await assert.rejects(()=>verifyTilePreview(original,reencoded,io),/decoded/);assert.equal(io.closed.length,1);
});
test('large or high-DPI map canvases remain inside GPU limits on initial load and resize',()=>{
  for(const size of [[1920,1080],[4992,2808],[12000,6000]])for(const hardware of [2048,4096,8192]){
    const result=mapCanvasSizing(size,{sharp:true,devicePixelRatio:2,maxTextureSize:hardware,maxRenderbufferSize:hardware});
    assert.ok(result.pixelRatio>0&&result.pixelRatio<=2);assert.ok(Math.ceil(size[0]*result.pixelRatio)<=Math.min(4096,hardware));assert.ok(Math.ceil(size[1]*result.pixelRatio)<=Math.min(4096,hardware));
  }
  assert.equal(mapCanvasSizing([1000,1000],{sharp:true,devicePixelRatio:2}).pixelRatio,2);
  assert.equal(mapCanvasSizing([1000,1000],{}).pixelRatio,1);
});
