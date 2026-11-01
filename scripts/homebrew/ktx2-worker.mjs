// KTX2 tile encoder (0.74): a classic worker (not a module), so it can load Basis Universal's
// encoder (lib/basis, Apache 2.0). Each message is one tile's pixels; the reply is its KTX2 file,
// ETC1S quality 255, one level, sRGB: the same as Toril's shipped tiles.
let ready = null;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    importScripts(data.loader);
    ready = BASIS({ locateFile: () => data.wasm }).then((m) => { m.initializeBasis(); return m; });
    ready.then(() => self.postMessage({ type: "ready" }), (e) => self.postMessage({ type: "ready", error: String(e?.message ?? e) }));
    return;
  }
  const { id, rgba, width, height } = data;
  let encoder = null;
  try {
    const m = await ready;
    encoder = new m.BasisEncoder();
    encoder.setCreateKTX2File(true);
    encoder.setKTX2UASTCSupercompression(false);
    encoder.setKTX2AndBasisSRGBTransferFunc(true);
    encoder.setSliceSourceImage(0, new Uint8Array(rgba), width, height, m.ldr_image_type.cRGBA32.value);
    encoder.setFormatMode(m.basis_tex_format.cETC1S.value);
    encoder.setMipGen(false);
    encoder.setPerceptual(true);
    encoder.setCheckForAlpha(false);
    encoder.setQualityLevel(255);
    encoder.setETC1SCompressionLevel(2);
    const out = new Uint8Array(width * height * 4 + 65536), size = encoder.encode(out);
    if (!size) throw Error("the encoder made no data");
    const bytes = out.slice(0, size);
    self.postMessage({ id, bytes }, [bytes.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  } finally {
    encoder?.delete?.();
  }
};
