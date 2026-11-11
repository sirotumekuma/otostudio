"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_MIDI, MAX_MIDI, isBlack, noteName } from "@/lib/audio/notes";
import { maxBars, normalizeProject, type Project } from "@/lib/project";

const ROW_H = 16;
const BEAT_W = 48;
const LABEL_W = 52;
const HEADER_H = 24;
const ROWS = MAX_MIDI - MIN_MIDI + 1;

const TIME_SIGS = ["4/4", "3/4", "2/4", "5/4", "6/8", "7/8", "12/8"];
const SNAP_OPTIONS = [
  { label: "1拍", value: 1 },
  { label: "1/2拍", value: 0.5 },
  { label: "1/4拍", value: 0.25 },
  { label: "1/8拍", value: 0.125 },
];

type Props = {
  project: Project;
  onChange: (updater: (p: Project) => Project) => void;
  onExport?: (format: "wav" | "mp3") => void | Promise<void>;
  activeMidi?: number | null;
};

function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** 入力中は自由に打て、確定(フォーカスを外す/Enter)したときに範囲内へ丸める数値欄 */
function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));

  function commit() {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || text.trim() === "") {
      setText(String(value));
      return;
    }
    const v = Math.min(max, Math.max(min, n));
    setText(String(v));
    onCommit(v);
  }

  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function PianoRoll({ project, onChange, onExport, activeMidi }: Props) {
  const { bpm, beatsPerBar, beatUnit, bars, snap, notes } = project;
  const total = bars * beatsPerBar;
  const gridW = total * BEAT_W;
  const gridH = ROWS * ROW_H;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<
    | { mode: "resize"; id: string; start: number }
    | { mode: "move"; id: string; start: number; midi: number; pointerBeat: number; pointerMidi: number }
    | null
  >(null);

  function update(patch: Partial<Project>) {
    onChange((p) => normalizeProject({ ...p, ...patch }));
  }

  // 最初にC5付近が見えるようにスクロール
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (MAX_MIDI - 78) * ROW_H;
  }, []);

  useEffect(() => {
    if (scrollRef.current == null || activeMidi == null || activeMidi < MIN_MIDI || activeMidi > MAX_MIDI) return;
    const y = (MAX_MIDI - activeMidi) * ROW_H;
    const target = Math.min(Math.max(y - 48, 0), Math.max(0, gridH - 200));
    scrollRef.current.scrollTop = target;
  }, [activeMidi, gridH]);

  // 上部の小節ルーラー
  useEffect(() => {
    const c = rulerRef.current;
    if (!c) return;
    const g = setupCanvas(c, gridW, HEADER_H);
    if (!g) return;
    g.fillStyle = "#1d2026";
    g.fillRect(0, 0, gridW, HEADER_H);
    g.font = "11px sans-serif";
    for (let b = 0; b <= total; b++) {
      const x = Math.round(b * BEAT_W);
      const isBar = b % beatsPerBar === 0;
      g.fillStyle = isBar ? "#4a5262" : "#323843";
      g.fillRect(x, isBar ? 0 : HEADER_H - 8, 1, isBar ? HEADER_H : 8);
      if (isBar && b < total) {
        g.fillStyle = "#9aa3b2";
        g.fillText(String(b / beatsPerBar + 1), x + 4, 15);
      }
    }
  }, [gridW, total, beatsPerBar]);

  // 左の音名(ピアノ鍵盤風)
  useEffect(() => {
    const c = labelsRef.current;
    if (!c) return;
    const g = setupCanvas(c, LABEL_W, gridH);
    if (!g) return;
    g.font = "10px sans-serif";
    for (let i = 0; i < ROWS; i++) {
      const midi = MAX_MIDI - i;
      const y = i * ROW_H;
      g.fillStyle = isBlack(midi) ? "#2a2f38" : "#d9dee7";
      g.fillRect(0, y, LABEL_W, ROW_H);
      g.fillStyle = "rgba(0,0,0,.25)";
      g.fillRect(0, y + ROW_H - 1, LABEL_W, 1);
      if (midi % 12 === 0) {
        g.fillStyle = "#1d2026";
        g.fillText(noteName(midi), 8, y + ROW_H - 4);
      }
    }
  }, [gridH]);

  // グリッドと音符
  useEffect(() => {
    const c = gridRef.current;
    if (!c) return;
    const g = setupCanvas(c, gridW, gridH);
    if (!g) return;

    for (let i = 0; i < ROWS; i++) {
      const midi = MAX_MIDI - i;
      const y = i * ROW_H;
      g.fillStyle = isBlack(midi) ? "#15181d" : "#1b1f26";
      g.fillRect(0, y, gridW, ROW_H);
      g.fillStyle = midi % 12 === 0 ? "#3d4552" : "#232830";
      g.fillRect(0, y + ROW_H - 1, gridW, 1);
    }
    if (activeMidi != null && activeMidi >= MIN_MIDI && activeMidi <= MAX_MIDI) {
      const y = (MAX_MIDI - activeMidi) * ROW_H;
      g.fillStyle = "rgba(91, 140, 255, 0.18)";
      g.fillRect(0, y, gridW, ROW_H);
    }

    for (let t = 0; t <= total; t += snap) {
      const x = Math.round(t * BEAT_W);
      g.fillStyle = t % beatsPerBar === 0 ? "#4a5262" : Number.isInteger(t) ? "#323843" : "#262b33";
      g.fillRect(x, 0, 1, gridH);
    }

    g.font = "10px sans-serif";
    for (const n of notes) {
      const x = n.start * BEAT_W;
      const y = (MAX_MIDI - n.midi) * ROW_H;
      const w = n.length * BEAT_W;
      g.fillStyle = "#5b8cff";
      g.fillRect(x + 1, y + 1, Math.max(2, w - 1), ROW_H - 2);
      if (w >= 30) {
        g.fillStyle = "#fff";
        g.fillText(noteName(n.midi), x + 5, y + ROW_H - 5);
      }
    }
  }, [gridW, gridH, total, beatsPerBar, snap, notes, activeMidi]);

  function toCell(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      beat: (e.clientX - r.left) / BEAT_W,
      midi: MAX_MIDI - Math.floor((e.clientY - r.top) / ROW_H),
    };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const { beat, midi } = toCell(e);
    if (midi < MIN_MIDI || midi > MAX_MIDI || beat < 0 || beat >= total) return;

    const hit = notes.find((n) => n.midi === midi && beat >= n.start && beat < n.start + n.length);
    if (e.button === 2) {
      if (!hit) return;
      drag.current = {
        mode: "move",
        id: hit.id,
        start: hit.start,
        midi: hit.midi,
        pointerBeat: beat,
        pointerMidi: midi,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (hit) {
      onChange((p) => ({ ...p, notes: p.notes.filter((n) => n.id !== hit.id) }));
      return;
    }

    // 空きをクリック → 追加(そのままドラッグで長さを伸ばせる)
    const start = Math.floor(beat / snap) * snap;
    const id = crypto.randomUUID();
    drag.current = { mode: "resize", id, start };
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange((p) => ({
      ...p,
      notes: [...p.notes, { id, midi, start, length: Math.min(snap, total - start) }],
    }));
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const { beat, midi } = toCell(e);
    if (d.mode === "move") {
      const current = notes.find((n) => n.id === d.id);
      if (!current) return;
      const beatDelta = Math.round((beat - d.pointerBeat) / snap) * snap;
      const start = Math.max(0, Math.min(total - current.length, d.start + beatDelta));
      const nextMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, d.midi + midi - d.pointerMidi));
      if (current.start === start && current.midi === nextMidi) return;
      onChange((p) => ({
        ...p,
        notes: p.notes.map((n) => (n.id === d.id ? { ...n, start, midi: nextMidi } : n)),
      }));
      return;
    }
    const end = Math.floor(beat / snap) * snap + snap;
    const length = Math.max(snap, Math.min(end - d.start, total - d.start));
    const cur = notes.find((n) => n.id === d.id);
    if (!cur || cur.length === length) return;
    onChange((p) => ({ ...p, notes: p.notes.map((n) => (n.id === d.id ? { ...n, length } : n)) }));
  }

  function endDrag() {
    drag.current = null;
  }

  return (
    <div className="pr">
      <div className="pr-toolbar">
        <label>
          BPM
          <NumberField value={bpm} min={20} max={300} onCommit={(v) => update({ bpm: v })} />
        </label>
        <label>
          拍子
          <select
            value={`${beatsPerBar}/${beatUnit}`}
            onChange={(e) => {
              const [a, b] = e.target.value.split("/").map(Number);
              update({ beatsPerBar: a, beatUnit: b });
            }}
          >
            {TIME_SIGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          小節数
          <NumberField value={bars} min={1} max={maxBars(beatsPerBar)} onCommit={(v) => update({ bars: v })} />
        </label>
        <label>
          グリッド
          <select value={snap} onChange={(e) => update({ snap: Number(e.target.value) })}>
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="pr-actions">
          <button
            className="pr-export"
            onClick={() => onExport?.("wav")}
          >
            WAV書き出し
          </button>
          <button
            className="pr-export alt"
            onClick={() => onExport?.("mp3")}
          >
            MP3書き出し
          </button>
        </div>
        <button
          className="pr-clear"
          onClick={() => {
            if (notes.length > 0 && window.confirm("すべての音符を消しますか?")) {
              onChange((p) => ({ ...p, notes: [] }));
            }
          }}
        >
          全消去
        </button>
        <span className="kb-hint">左クリックで追加/削除・左ドラッグで長さ変更・右ドラッグで移動</span>
      </div>

      <div className="pr-scroll" ref={scrollRef}>
        <div
          className="pr-inner"
          style={{
            gridTemplateColumns: `${LABEL_W}px ${gridW}px`,
            gridTemplateRows: `${HEADER_H}px ${gridH}px`,
          }}
        >
          <div className="pr-corner" />
          <canvas ref={rulerRef} className="pr-ruler" />
          <canvas ref={labelsRef} className="pr-labels" />
          <canvas
            ref={gridRef}
            className="pr-grid"
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>
    </div>
  );
}
