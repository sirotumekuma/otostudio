// WSOLA(波形の重なりを探しながら繋ぐ方式)による、ピッチを変えない時間伸縮。
// 「時間を維持してピッチを変える」ために使う:
//   ピッチ比 r のとき、音を r 倍に引き延ばしてから r 倍速で再生する
//   → ピッチは r 倍になり、長さは元のまま。

const WIN = 1024; // 窓の長さ
const HOP = 512; // 出力側の送り幅
const TOL = 256; // 繋ぎ位置の探索範囲(±)
const DEC = 4; // 相関計算の間引き

const HANN = (() => {
  const w = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
  return w;
})();

/** buf を factor 倍の長さに伸ばした(ピッチは同じ)バッファを返す */
export function stretchBuffer(buf: AudioBuffer, factor: number): AudioBuffer {
  const chCount = buf.numberOfChannels;
  const len = buf.length;
  const outLen = Math.max(1, Math.ceil(len * factor));

  const channels: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) channels.push(buf.getChannelData(c));

  // 解析用のモノラル波形(左右で同じ繋ぎ位置を使い、位相ずれを防ぐ)
  let mono = channels[0];
  if (chCount > 1) {
    mono = new Float32Array(len);
    for (const d of channels) for (let i = 0; i < len; i++) mono[i] += d[i] / chCount;
  }

  // 各フレームの入力側の位置を決める
  const frames = Math.ceil(outLen / HOP) + 1;
  const pos = new Int32Array(frames);
  const hopIn = HOP / factor;
  const maxStart = Math.max(0, len - WIN);

  for (let k = 1; k < frames; k++) {
    const nominal = Math.round(k * hopIn);
    const target = pos[k - 1] + HOP; // 直前のフレームの「自然な続き」
    const lo = Math.max(0, nominal - TOL);
    const hi = Math.min(maxStart, nominal + TOL);
    if (lo > hi) {
      pos[k] = hi;
      continue;
    }
    let best = Math.min(Math.max(nominal, lo), hi);
    let bestCorr = -Infinity;
    for (let p = lo; p <= hi; p += 2) {
      const n = Math.min(WIN, len - Math.max(p, target));
      let corr = 0;
      for (let i = 0; i < n; i += DEC) corr += mono[p + i] * mono[target + i];
      if (corr > bestCorr) {
        bestCorr = corr;
        best = p;
      }
    }
    pos[k] = best;
  }

  const out = new AudioBuffer({ length: outLen, numberOfChannels: chCount, sampleRate: buf.sampleRate });
  for (let c = 0; c < chCount; c++) {
    const x = channels[c];
    const y = new Float32Array(outLen + WIN);
    const w = new Float32Array(outLen + WIN);
    for (let k = 0; k < frames; k++) {
      const o = k * HOP;
      const p = pos[k];
      for (let i = 0; i < WIN; i++) {
        const idx = p + i;
        const v = idx < len ? x[idx] : 0;
        y[o + i] += v * HANN[i];
        w[o + i] += HANN[i];
      }
    }
    const res = new Float32Array(outLen);
    for (let n = 0; n < outLen; n++) res[n] = w[n] > 1e-4 ? y[n] / w[n] : 0;
    out.copyToChannel(res, c);
  }
  return out;
}

// 計算結果のキャッシュ(最近使ったものを残す)
const cache = new Map<string, AudioBuffer>();
const CACHE_MAX = 24;

export function getStretched(key: string, buf: AudioBuffer, factor: number): AudioBuffer {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const res = stretchBuffer(buf, factor);
  cache.set(key, res);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return res;
}
