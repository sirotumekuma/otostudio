import type { Source } from "@/lib/audio/types";
import type { Project, Track } from "@/lib/project";
import { getStretched } from "./stretch";

export type Voice = { buffer: AudioBuffer; rate: number };

/** トラック設定から、鍵盤(midi)で鳴らす音源と「元の音程の鍵」を決める */
export function resolveSource(
  track: Track,
  midi: number,
  sources: Source[]
): { source: Source; base: number } | null {
  if (track.mode === "single") {
    const s = sources.find((x) => x.id === track.sourceId);
    return s ? { source: s, base: s.baseMidi } : null;
  }
  const s = sources.find((x) => x.id === track.assignments[midi]);
  return s ? { source: s, base: midi } : null; // 割り当てモードは元の音程で再生
}

/** 再生・書き出しの前に、使う音(必要なら時間維持のピッチ変更済み)を用意する */
export async function prepareVoices(project: Project, sources: Source[]): Promise<Map<string, Voice>> {
  const voices = new Map<string, Voice>();
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));
  let heavy = 0;

  for (const n of project.notes) {
    const trackId = n.trackId ?? project.activeTrackId;
    const key = `${trackId}|${n.midi}`;
    if (voices.has(key)) continue;
    const t = trackById.get(trackId);
    if (!t) continue;
    const r = resolveSource(t, n.midi, sources);
    if (!r) continue;

    const semis = n.midi - r.base + project.transpose;
    const rate = Math.pow(2, semis / 12);
    if (t.stretch && semis !== 0) {
      voices.set(key, { buffer: getStretched(`${r.source.id}|${semis}`, r.source.buffer, rate), rate });
      heavy++;
      if (heavy % 2 === 0) await new Promise((res) => setTimeout(res, 0)); // 画面が固まらないよう処理を譲る
    } else {
      voices.set(key, { buffer: r.source.buffer, rate });
    }
  }
  return voices;
}

export type Graph = { inputs: Map<string, AudioNode>; master: GainNode };

function makeImpulse(ctx: BaseAudioContext, seconds = 1.8): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  return buf;
}

/** ミキサー(音量・パン・ミュート/ソロ)とエフェクトの接続を組み立てる */
export function buildGraph(ctx: BaseAudioContext, project: Project): Graph {
  const master = ctx.createGain();
  master.gain.value = project.master;
  master.connect(ctx.destination);

  const anySolo = project.tracks.some((t) => t.solo);
  const inputs = new Map<string, AudioNode>();
  let impulse: AudioBuffer | null = null;

  for (const t of project.tracks) {
    const audible = !t.mute && (!anySolo || t.solo);
    const input = ctx.createGain();
    input.gain.value = audible ? t.volume : 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = t.pan;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = t.lowpass;
    lp.Q.value = 0.7;
    const out = ctx.createGain();

    input.connect(pan);
    pan.connect(lp);
    lp.connect(out);
    out.connect(master);

    if (t.delay > 0) {
      const delay = ctx.createDelay(2);
      delay.delayTime.value = (60 / project.bpm) * 0.5; // 半拍(テンポに同期)
      const send = ctx.createGain();
      send.gain.value = t.delay;
      const fb = ctx.createGain();
      fb.gain.value = 0.4;
      lp.connect(send);
      send.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(out);
    }
    if (t.reverb > 0) {
      if (!impulse) impulse = makeImpulse(ctx);
      const conv = ctx.createConvolver();
      conv.buffer = impulse;
      const send = ctx.createGain();
      send.gain.value = t.reverb;
      lp.connect(send);
      send.connect(conv);
      conv.connect(out);
    }
    inputs.set(t.id, input);
  }
  return { inputs, master };
}

/** 1つの音符を、指定時刻に鳴らす予約をする */
export function scheduleNote(
  ctx: BaseAudioContext,
  input: AudioNode,
  voice: Voice,
  track: Track,
  when: number,
  durSec: number,
  offsetSec = 0
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = voice.buffer;
  src.playbackRate.value = voice.rate;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + 0.004);
  src.connect(g);
  g.connect(input);
  src.start(when, offsetSec);

  if (track.gate) {
    const end = when + Math.max(0.02, durSec);
    g.gain.setValueAtTime(1, end);
    g.gain.linearRampToValueAtTime(0, end + 0.02);
    src.stop(end + 0.03);
  }
  src.onended = () => g.disconnect();
  return src;
}

export type Session = {
  startTime: number; // AudioContext上の再生開始時刻(秒)
  fromBeat: number;
  secPerBeat: number;
  stop: (immediate: boolean) => void;
};

/** ピアノロールの再生を開始する */
export function startPlayback(
  ctx: AudioContext,
  project: Project,
  voices: Map<string, Voice>,
  fromBeat: number
): Session {
  const graph = buildGraph(ctx, project);
  const secPerBeat = 60 / project.bpm;
  const t0 = ctx.currentTime + 0.1;
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));
  const sources: AudioBufferSourceNode[] = [];

  for (const n of project.notes) {
    const trackId = n.trackId ?? project.activeTrackId;
    const voice = voices.get(`${trackId}|${n.midi}`);
    const track = trackById.get(trackId);
    const input = graph.inputs.get(trackId);
    if (!voice || !track || !input) continue;
    const noteDuration = track.gate ? n.length * secPerBeat : voice.buffer.duration / voice.rate;
    const elapsed = Math.max(0, fromBeat - n.start) * secPerBeat;
    if (elapsed >= noteDuration) continue;
    const startBeat = Math.max(n.start, fromBeat);
    const remaining = noteDuration - elapsed;
    sources.push(
      scheduleNote(
        ctx,
        input,
        voice,
        track,
        t0 + (startBeat - fromBeat) * secPerBeat,
        track.gate ? remaining : noteDuration,
        elapsed
      )
    );
  }

  return {
    startTime: t0,
    fromBeat,
    secPerBeat,
    stop(immediate: boolean) {
      if (immediate) {
        graph.master.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            // すでに終了している音は何もしない
          }
        }
        setTimeout(() => graph.master.disconnect(), 300);
      } else {
        // 最後まで再生が終わった場合は、ディレイ/リバーブの余韻を残してから片付ける
        setTimeout(() => graph.master.disconnect(), 4000);
      }
    },
  };
}

/** プロジェクト全体を1本の音声にレンダリングする(書き出し用) */
export async function renderProject(
  project: Project,
  sources: Source[],
  voices: Map<string, Voice>
): Promise<AudioBuffer> {
  const sr = 44100;
  const secPerBeat = 60 / project.bpm;
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));

  let maxEnd = 0;
  let count = 0;
  for (const n of project.notes) {
    const trackId = n.trackId ?? project.activeTrackId;
    const voice = voices.get(`${trackId}|${n.midi}`);
    const track = trackById.get(trackId);
    if (!voice || !track) continue;
    count++;
    const dur = track.gate ? n.length * secPerBeat : voice.buffer.duration / voice.rate;
    maxEnd = Math.max(maxEnd, n.start * secPerBeat + dur);
  }
  if (count === 0) throw new Error("音源が割り当てられた音符がありません");

  const seconds = Math.min(300, maxEnd + 2.5); // 余韻の分を足す(最大5分)
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const graph = buildGraph(ctx, project);

  for (const n of project.notes) {
    const trackId = n.trackId ?? project.activeTrackId;
    const voice = voices.get(`${trackId}|${n.midi}`);
    const track = trackById.get(trackId);
    const input = graph.inputs.get(trackId);
    if (!voice || !track || !input) continue;
    scheduleNote(ctx, input, voice, track, n.start * secPerBeat, n.length * secPerBeat);
  }
  void sources;
  return ctx.startRendering();
}
