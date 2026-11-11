function peakOf(buf: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** 音割れ防止: ピークが1を超える場合だけ全体を小さくする */
function safeGain(buf: AudioBuffer): number {
  const peak = peakOf(buf);
  return peak > 1 ? 1 / peak : 1;
}

function toInt16(data: Float32Array, gain: number): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * gain));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** 16bit PCM の WAV を作る */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = Math.min(2, buf.numberOfChannels);
  const len = buf.length;
  const gain = safeGain(buf);
  const left = toInt16(buf.getChannelData(0), gain);
  const right = ch === 2 ? toInt16(buf.getChannelData(1), gain) : null;

  const dataSize = len * ch * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataSize, true);

  let o = 44;
  for (let i = 0; i < len; i++) {
    v.setInt16(o, left[i], true);
    o += 2;
    if (right) {
      v.setInt16(o, right[i], true);
      o += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** MP3を作る(@breezystack/lamejs を使用。必要なときだけ読み込む) */
export async function encodeMp3(buf: AudioBuffer, kbps = 192): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const ch = Math.min(2, buf.numberOfChannels);
  const gain = safeGain(buf);
  const left = toInt16(buf.getChannelData(0), gain);
  const right = ch === 2 ? toInt16(buf.getChannelData(1), gain) : null;
  const enc = new Mp3Encoder(ch, buf.sampleRate, kbps);

  const chunks: BlobPart[] = [];
  const BLOCK = 1152;
  for (let i = 0; i < left.length; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK);
    const out = right ? enc.encodeBuffer(l, right.subarray(i, i + BLOCK)) : enc.encodeBuffer(l);
    if (out.length > 0) chunks.push(new Uint8Array(out));
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));
  return new Blob(chunks, { type: "audio/mpeg" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
