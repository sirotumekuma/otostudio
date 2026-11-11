import { getAudioContext } from "./decode";

/** 元の音がそのまま鳴る基準の鍵(C4) */
export const BASE_MIDI = 60;

export type NoteHandle = { stop: () => void };

/** 音源を指定の鍵のピッチで再生する(通常のピッチ変更: 速度も一緒に変わる) */
export function playNote(
  buffer: AudioBuffer,
  midi: number,
  baseMidi: number = BASE_MIDI
): NoteHandle {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") void ctx.resume();

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, (midi - baseMidi) / 12);

  // プチッという雑音を避けるため、短いフェードイン/アウトを付ける
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + 0.005);

  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.onended = () => gain.disconnect();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.05);
      try {
        src.stop(t + 0.06);
      } catch {
        // すでに終了している場合は何もしない
      }
    },
  };
}
