import test from 'node:test';
import assert from 'node:assert/strict';
import {zipParts,zipEntry,zipCanBuild,zipFits} from '../scripts/homebrew/plan.mjs';

test('large realm archives use ZIP64 directory counts instead of dropping files',async()=>{
  const entry=zipEntry('x',new Uint8Array()),entries=Array.from({length:65535},(_,i)=>({...entry,name:`file-${i}`}));
  assert.equal(zipFits(entries),false);assert.equal(zipCanBuild(entries),true);
  const parts=zipParts(entries),end=new DataView(parts.at(-1).buffer),locator=new DataView(parts.at(-2).buffer),extended=new DataView(parts.at(-3).buffer);
  assert.equal(end.getUint16(8,true),65535);assert.equal(locator.getUint32(0,true),0x07064b50);assert.equal(extended.getUint32(0,true),0x06064b50);assert.equal(extended.getBigUint64(24,true),65535n);
  assert.equal(extended.getBigUint64(32,true),65535n);
  assert.equal(locator.getBigUint64(8,true),extended.getBigUint64(40,true)+extended.getBigUint64(48,true));
});

test('ZIP64 retains 64-bit file sizes and offsets without allocating a multi-gigabyte test buffer',()=>{
  const large={name:'large.bin',crc:0,size:2**32+100,body:new Uint8Array()},small=zipEntry('tail',new Uint8Array([1]));
  const parts=zipParts([large,small]),local=new DataView(parts[0].buffer),extra=new DataView(parts[2].buffer);
  assert.equal(local.getUint32(18,true),0xffffffff);assert.equal(extra.getBigUint64(4,true),BigInt(large.size));assert.equal(extra.getBigUint64(12,true),BigInt(large.size));
  const central=parts.filter(p=>p instanceof Uint8Array&&p.byteLength===46&&new DataView(p.buffer,p.byteOffset,p.byteLength).getUint32(0,true)===0x02014b50);
  assert.equal(new DataView(central[1].buffer).getUint32(42,true),0xffffffff);
  assert.equal(zipCanBuild([{name:'bad',size:-1}]),false);assert.equal(zipCanBuild([{name:'bad',size:Number.MAX_SAFE_INTEGER}]),false);
});
