import { Archive } from '../pmtiles.mjs';

export function worldDirectory(base) {
  const url = new URL(base, globalThis.location?.href ?? 'http://localhost/');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

/** Two workers, bounded caches, and range reads of only the visible area's local inputs. */
export class TerrainDetail {
  constructor(base, options) {
    this.base = worldDirectory(base); this.options = options;
    this.archive = new Archive(new URL(options.archive, this.base).href);
    this.models = new Map(); this.images = new Map(); this.pending = new Map(); this.queue = []; this.serial = 0;
    this.workers = Array.from({ length: 2 }, () => {
      const slot = { worker: new Worker(new URL('./detail-worker.mjs', import.meta.url), { type: 'module' }), busy: false };
      slot.worker.onmessage = ({ data }) => {
        const job = slot.job; slot.busy = false; slot.job = null;
        if (data.error) job.reject(new Error(data.error)); else job.resolve(new Uint8Array(data.bytes));
        this.pump();
      };
      slot.worker.onerror = (e) => { this.error = new Error(e.message || 'Terrain detail worker failed'); slot.job?.reject(this.error); slot.busy = false; slot.worker.terminate(); for (const job of this.queue.splice(0)) job.reject(this.error); };
      return slot;
    });
  }
  async model(x, y) {
    const key = `${x}/${y}`;
    if (this.models.has(key)) { const p = this.models.get(key); this.models.delete(key); this.models.set(key, p); return p; }
    const p = this.archive.tile(this.options.baseZoom, x, y);
    this.models.set(key, p);
    p.catch(() => this.models.delete(key));
    while (this.models.size > 16) this.models.delete(this.models.keys().next().value);
    return p;
  }
  tile(z, x, y, mode = 'relief', signal) {
    if (this.error) return Promise.reject(this.error);
    const key = `${mode}/${z}/${x}/${y}`;
    if (this.images.has(key)) { const bytes = this.images.get(key); this.images.delete(key); this.images.set(key, bytes); return Promise.resolve(bytes); }
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      if (z < this.options.baseZoom) {
        const image = new OffscreenCanvas(256, 256), c = image.getContext('2d');
        await Promise.all([0,1,2,3].map(async i => {
          const bytes = await this.tile(z+1, x*2+(i%2), y*2+Math.floor(i/2), mode, signal);
          const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
          if (mode === 'relief') {
            const full=new OffscreenCanvas(256,256), fc=full.getContext('2d',{willReadFrequently:true});
            fc.drawImage(bitmap,0,0);const data=fc.getImageData(0,0,256,256).data,small=new Uint8ClampedArray(128*128*4);
            for(let yy=0;yy<128;yy++)for(let xx=0;xx<128;xx++) {
              let height=0;
              for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const o=((yy*2+dy)*256+xx*2+dx)*4;height+=(data[o]*65536+data[o+1]*256+data[o+2])/4;}
              const v=Math.round(height),o=(yy*128+xx)*4;small.set([v>>16,(v>>8)&255,v&255,255],o);
            }
            c.putImageData(new ImageData(small,128,128),(i%2)*128,Math.floor(i/2)*128);
          } else c.drawImage(bitmap,(i%2)*128,Math.floor(i/2)*128,128,128);
          bitmap.close();
        }));
        const bytes = new Uint8Array(await (await image.convertToBlob({type:'image/png'})).arrayBuffer());
        this.images.set(key,bytes);
        while(this.images.size>96)this.images.delete(this.images.keys().next().value);
        return bytes;
      }
      const n = 2 ** (z - this.options.baseZoom), model = await this.model(Math.floor(x / n), Math.floor(y / n));
      if (!model) {
        // Padded extent corners can contain no reference data. Keep those tiles flat/transparent.
        const image=new OffscreenCanvas(256,256),c=image.getContext('2d');
        if(mode==='relief'){c.fillStyle='#0186a0';c.fillRect(0,0,256,256);}
        return new Uint8Array(await(await image.convertToBlob({type:'image/png'})).arrayBuffer());
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const bytes = await new Promise((resolve, reject) => { this.queue.push({ id: ++this.serial, z, x, y, mode, model, signal, resolve, reject }); this.pump(); });
      this.images.set(key, bytes);
      while (this.images.size > 96) this.images.delete(this.images.keys().next().value);
      return bytes;
    })();
    this.pending.set(key, task);
    task.finally(() => this.pending.delete(key)).catch(() => {});
    return task;
  }
  pump() {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      let job;
      while ((job = this.queue.shift()) && job.signal?.aborted) job.reject(new DOMException('Aborted', 'AbortError'));
      if (!job) continue;
      slot.busy = true; slot.job = job;
      slot.worker.postMessage({ id: job.id, z: job.z, x: job.x, y: job.y, mode: job.mode, base: this.base, model: job.model.buffer.slice(job.model.byteOffset, job.model.byteOffset + job.model.byteLength) });
    }
  }
}
