import type { Source } from "./types";

let ctx: AudioContext | null = null;

/** AudioContextは1つを使い回す(最初の呼び出し時に作成) */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

const SUPPORTED_EXT = ["wav", "mp3", "ogg", "m4a"];

export type DecodeResult =
  | { ok: true; source: Source }
  | { ok: false; message: string };

export async function decodeFile(file: File): Promise<DecodeResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (!SUPPORTED_EXT.includes(ext)) {
    return {
      ok: false,
      message: `「${file.name}」は対応していない形式です。WAV / MP3 / OGG のファイルを選んでください。`,
    };
  }

  try {
    const data = await file.arrayBuffer();
    const buffer = await getAudioContext().decodeAudioData(data);
    return {
      ok: true,
      source: {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        buffer,
        baseMidi: 60,
        createdAt: Date.now(),
      },
    };
  } catch {
    const hint =
      ext === "m4a"
        ? "M4Aはお使いのブラウザでは読み込めない場合があります。WAVまたはMP3に変換してお試しください。"
        : "ファイルが壊れているか、読み込めない形式の可能性があります。";
    return { ok: false, message: `「${file.name}」を読み込めませんでした。${hint}` };
  }
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

/** 保存済みのファイル(Blob)から再デコードする(復元用) */
export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  return getAudioContext().decodeAudioData(await blob.arrayBuffer());
}
