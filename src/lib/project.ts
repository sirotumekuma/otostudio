import { MIN_MIDI, MAX_MIDI } from "@/lib/audio/notes";

/** ピアノロール上の音符。位置と長さの単位は「拍」(拍子の分母の音符 = 1拍) */
export type Note = {
  id: string;
  midi: number;
  start: number; // 拍
  length: number; // 拍
  trackId?: string;
};

export type TrackMode = "single" | "multi";

export type Track = {
  id: string;
  name: string;
  mode: TrackMode;
  sourceId: string | null;
  assignments: Record<number, string>;
  volume: number;
  pan: number;
  delay: number;
  reverb: number;
  lowpass: number;
  mute: boolean;
  solo: boolean;
  stretch: boolean;
  gate: boolean;
};

export type Project = {
  bpm: number; // 1分あたりの拍数
  beatsPerBar: number; // 拍子の分子
  beatUnit: number; // 拍子の分母
  bars: number; // 小節数
  snap: number; // グリッド幅(拍)
  notes: Note[];
  tracks: Track[];
  activeTrackId: string;
  master: number;
};

export const MAX_TRACKS = 8;
export const TRACK_COLORS = ["#5b8cff", "#8d8cff", "#ff8f70", "#7dd3a8", "#fbbf24", "#f472b6", "#2dd4bf", "#f59e0b"] as const;

export function createTrack(id: string, name: string, sourceId: string | null = null): Track {
  return {
    id,
    name,
    mode: "single",
    sourceId,
    assignments: {},
    volume: 1,
    pan: 0,
    delay: 0,
    reverb: 0,
    lowpass: 20000,
    mute: false,
    solo: false,
    stretch: false,
    gate: false,
  };
}

export const DEFAULT_PROJECT: Project = {
  bpm: 120,
  beatsPerBar: 4,
  beatUnit: 4,
  bars: 8,
  snap: 0.25,
  notes: [],
  tracks: [createTrack("track-1", "Track 1")],
  activeTrackId: "track-1",
  master: 0.9,
};

/** 画面が重くならないよう、全体の長さに上限を設ける */
export const MAX_TOTAL_BEATS = 128;
export const SNAP_VALUES = [1, 0.5, 0.25, 0.125];

export function maxBars(beatsPerBar: number): number {
  return Math.max(1, Math.floor(MAX_TOTAL_BEATS / beatsPerBar));
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function normalizeTrack(raw: Partial<Track> | undefined, fallbackId: string): Track {
  const id = typeof raw?.id === "string" && raw.id ? raw.id : fallbackId;
  const mode = raw?.mode === "multi" ? "multi" : "single";
  const sourceId = typeof raw?.sourceId === "string" ? raw.sourceId : null;
  const assignments = Object.fromEntries(
    Object.entries(raw?.assignments ?? {}).filter(([, value]) => typeof value === "string")
  ) as Record<number, string>;

  return {
    id,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : `Track ${fallbackId.replace(/[^0-9]/g, "") || "1"}`,
    mode,
    sourceId,
    assignments,
    volume: clamp(num(raw?.volume, 1), 0, 1.2),
    pan: clamp(num(raw?.pan, 0), -1, 1),
    delay: clamp(num(raw?.delay, 0), 0, 1),
    reverb: clamp(num(raw?.reverb, 0), 0, 1),
    lowpass: clamp(Math.round(num(raw?.lowpass, 20000)), 200, 20000),
    mute: !!raw?.mute,
    solo: !!raw?.solo,
    stretch: !!raw?.stretch,
    gate: !!raw?.gate,
  };
}

/** 値を許容範囲に収め、範囲外の音符を取り除く(保存データの復元時にも使う) */
export function normalizeProject(p: Partial<Project>): Project {
  const beatsPerBar = clamp(Math.round(num(p.beatsPerBar, 4)), 1, 16);
  const beatUnit = [2, 4, 8, 16].includes(num(p.beatUnit, 4)) ? num(p.beatUnit, 4) : 4;
  const bars = clamp(Math.round(num(p.bars, 8)), 1, maxBars(beatsPerBar));
  const bpm = clamp(Math.round(num(p.bpm, 120)), 20, 300);
  const snap = SNAP_VALUES.includes(num(p.snap, 0.25)) ? num(p.snap, 0.25) : 0.25;
  const total = bars * beatsPerBar;
  const defaultTrack = createTrack("track-1", "Track 1");
  const rawTracks = Array.isArray(p.tracks) && p.tracks.length > 0 ? p.tracks : [defaultTrack];
  const tracks = rawTracks.map((track, idx) => normalizeTrack(track, `track-${idx + 1}`));
  const activeTrackId =
    typeof p.activeTrackId === "string" && tracks.some((t) => t.id === p.activeTrackId)
      ? p.activeTrackId
      : tracks[0]?.id ?? defaultTrack.id;

  const notes: Note[] = (Array.isArray(p.notes) ? p.notes : [])
    .filter(
      (n): n is Note =>
        !!n &&
        typeof n.id === "string" &&
        typeof n.midi === "number" &&
        typeof n.start === "number" &&
        typeof n.length === "number" &&
        n.midi >= MIN_MIDI &&
        n.midi <= MAX_MIDI &&
        n.start >= 0 &&
        n.start < total
    )
    .map((n) => ({
      ...n,
      trackId: typeof n.trackId === "string" && n.trackId ? n.trackId : activeTrackId,
      length: clamp(n.length, 0.125, total - n.start),
    }));

  return {
    bpm,
    beatsPerBar,
    beatUnit,
    bars,
    snap,
    notes,
    tracks,
    activeTrackId,
    master: clamp(num(p.master, 0.9), 0, 1),
  };
}
