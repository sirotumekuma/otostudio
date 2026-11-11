export type Source = {
  id: string;
  name: string;
  duration: number; // 秒
  sampleRate: number;
  channels: number;
  buffer: AudioBuffer;
  baseMidi: number; // 元の音が鳴る鍵(MIDI番号。初期値はC4=60)
  createdAt: number;
};

/** 鍵盤の使い方: 単一音源を全鍵盤でピッチ変更 / 音源を鍵盤ごとに割り当て */
export type Mode = "single" | "multi";

/** 鍵盤(MIDI番号) → 音源ID */
export type Assignments = Record<number, string>;
