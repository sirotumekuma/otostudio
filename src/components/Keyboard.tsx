"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Assignments, Mode, Source } from "@/lib/audio/types";
import { MIN_MIDI, MAX_MIDI, isBlack, noteName } from "@/lib/audio/notes";
import { playNote, type NoteHandle } from "@/lib/audio/player";

const WHITE_W = 28;
const BLACK_W = 18;

type Key = { midi: number; black: boolean; left: number };

type Props = {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  selected: Source | null;
  sources: Source[];
  assignments: Assignments;
  onAssign: (midi: number) => void;
  activeMidi?: number | null;
  onMidiFocus?: (midi: number | null) => void;
};

export function Keyboard({ mode, onModeChange, selected, sources, assignments, onAssign, activeMidi, onMidiFocus }: Props) {
  const active = useRef(new Map<number, NoteHandle>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const assigning = mode === "multi" && editing;

  const { keys, width } = useMemo(() => {
    const list: Key[] = [];
    let whiteCount = 0;
    for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
      if (isBlack(m)) {
        list.push({ midi: m, black: true, left: whiteCount * WHITE_W - BLACK_W / 2 });
      } else {
        list.push({ midi: m, black: false, left: whiteCount * WHITE_W });
        whiteCount++;
      }
    }
    return { keys: list, width: whiteCount * WHITE_W };
  }, []);

  // 最初にC3付近が見えるようにスクロール
  useEffect(() => {
    const c3 = keys.find((k) => k.midi === 48);
    if (scrollRef.current && c3) scrollRef.current.scrollLeft = c3.left;
  }, [keys]);

  // 画面を離れるときは鳴っている音を止める
  useEffect(() => {
    const map = active.current;
    return () => {
      map.forEach((h) => h.stop());
      map.clear();
    };
  }, []);

  /** その鍵盤で鳴らす音源と、元の音程の鍵(base)を決める */
  function resolve(midi: number): { buffer: AudioBuffer; base: number } | null {
    if (mode === "single") {
      return selected ? { buffer: selected.buffer, base: selected.baseMidi } : null;
    }
    const src = sources.find((s) => s.id === assignments[midi]);
    return src ? { buffer: src.buffer, base: midi } : null; // 割り当てモードは元の音程で再生
  }

  function down(midi: number) {
    onMidiFocus?.(midi);
    active.current.get(midi)?.stop();
    if (assigning) {
      if (!selected) return;
      onAssign(midi);
      active.current.set(midi, playNote(selected.buffer, midi, midi)); // 試し聞き
      return;
    }
    const r = resolve(midi);
    if (!r) return;
    active.current.set(midi, playNote(r.buffer, midi, r.base));
  }

  function up(midi: number) {
    active.current.get(midi)?.stop();
    active.current.delete(midi);
  }

  function assignedName(midi: number): string | null {
    if (mode !== "multi") return null;
    const src = sources.find((s) => s.id === assignments[midi]);
    return src ? src.name.slice(0, 2) : null;
  }

  let hint = "";
  if (mode === "single") {
    hint = selected ? `${noteName(selected.baseMidi)}で元の音程` : "音源を選ぶと弾けます";
  } else if (editing) {
    hint = selected
      ? `「${selected.name}」を鍵盤クリックで割り当て(割り当て済みをもう一度クリックで解除)`
      : "左の一覧で音源を選んでください";
  } else {
    hint = "割り当てた鍵盤を押すと、その音源が元の音程で鳴ります";
  }

  return (
    <section className="keyboard">
      <div className="kb-head">
        <p className="panel-title">鍵盤 C1〜C7</p>
        <div className="seg">
          <button className={mode === "single" ? "on" : ""} onClick={() => onModeChange("single")}>
            単一音源
          </button>
          <button className={mode === "multi" ? "on" : ""} onClick={() => onModeChange("multi")}>
            個別割り当て
          </button>
        </div>
        {mode === "multi" && (
          <button className={`assign-btn${editing ? " on" : ""}`} onClick={() => setEditing((v) => !v)}>
            割り当て編集 {editing ? "ON" : "OFF"}
          </button>
        )}
        <span className="kb-hint">{hint}</span>
      </div>

      <div className="keys-scroll" ref={scrollRef}>
        <div
          className={`keys${mode === "single" && !selected ? " disabled" : ""}`}
          style={{ width }}
        >
          {keys.map((k) => {
            const name = assignedName(k.midi);
            const isBase = mode === "single" && selected && k.midi === selected.baseMidi;
            const isActive = activeMidi === k.midi;
            const cls = [
              "key",
              k.black ? "black" : "white",
              isBase ? "base" : "",
              name ? "assigned" : "",
              isActive ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={k.midi}
                className={cls}
                style={{ left: k.left }}
                title={name ? `${noteName(k.midi)}: ${name}` : noteName(k.midi)}
                onPointerDown={() => down(k.midi)}
                onPointerUp={() => {
                  up(k.midi);
                  onMidiFocus?.(null);
                }}
                onPointerLeave={() => {
                  up(k.midi);
                  onMidiFocus?.(null);
                }}
                onPointerCancel={() => {
                  up(k.midi);
                  onMidiFocus?.(null);
                }}
              >
                {!k.black ? name ?? (k.midi % 12 === 0 ? noteName(k.midi) : "") : ""}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
