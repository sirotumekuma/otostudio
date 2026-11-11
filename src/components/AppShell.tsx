"use client";

import { useEffect, useRef, useState } from "react";
import type { Assignments, Mode, Source } from "@/lib/audio/types";
import { decodeBlob, decodeFile, getAudioContext } from "@/lib/audio/decode";
import { MIN_MIDI, MAX_MIDI, noteName } from "@/lib/audio/notes";
import { getMeta, loadSources, removeSource, saveSource, setMeta, updateBase } from "@/lib/db";
import { SourceList } from "./SourceList";
import { Keyboard } from "./Keyboard";
import { Waveform } from "./Waveform";
import { PianoRoll } from "./PianoRoll";
import { DEFAULT_PROJECT, normalizeProject, type Project } from "@/lib/project";
import { prepareVoices, renderProject, startPlayback, type Session } from "@/lib/engine";
import { downloadBlob, encodeMp3, encodeWav } from "@/lib/encode";

const MIDI_OPTIONS = Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, i) => MIN_MIDI + i);

type SavedState = {
  mode: Mode;
  assignments: Assignments;
  selectedId: string | null;
  project?: Project;
};

export function AppShell() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("single");
  const [assignments, setAssignments] = useState<Assignments>({});
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const [project, setProject] = useState<Project>(DEFAULT_PROJECT);
  const [view, setView] = useState<"wave" | "roll">("wave");
  const [playing, setPlaying] = useState(false);
  const [activeMidi, setActiveMidi] = useState<number | null>(null);
  const playbackRef = useRef<Session | null>(null);
  const playbackTimerRef = useRef<number | null>(null);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  // 起動時: IndexedDBから音源と設定を復元
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadSources();
        const list: Source[] = [];
        for (const s of stored) {
          try {
            const buffer = await decodeBlob(s.blob);
            list.push({
              id: s.id,
              name: s.name,
              duration: buffer.duration,
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
              buffer,
              baseMidi: s.baseMidi,
              createdAt: s.createdAt,
            });
          } catch {
            // 読み込めない音源はスキップ
          }
        }
        const meta = (await getMeta("state")) as SavedState | undefined;
        if (cancelled) return;

        const ids = new Set(list.map((s) => s.id));
        setSources(list);
        if (meta) {
          setMode(meta.mode === "multi" ? "multi" : "single");
          setProject(normalizeProject({ ...DEFAULT_PROJECT, ...(meta.project ?? {}) }));
          setAssignments(
            Object.fromEntries(Object.entries(meta.assignments ?? {}).filter(([, id]) => ids.has(id)))
          );
          setSelectedId(meta.selectedId && ids.has(meta.selectedId) ? meta.selectedId : list[0]?.id ?? null);
        } else {
          setSelectedId(list[0]?.id ?? null);
        }
      } catch {
        if (!cancelled) {
          setErrors(["保存データを読み込めませんでした。このブラウザでは保存機能が使えない可能性があります。"]);
        }
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 設定の自動保存(復元が終わってから)
  useEffect(() => {
    if (!restored) return;
    // 操作のたびに書き込まないよう、少し待ってから保存する
    const t = setTimeout(() => {
      setMeta("state", { mode, assignments, selectedId, project }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [restored, mode, assignments, selectedId, project]);

  async function handleAddFiles(files: File[]) {
    if (files.length === 0) return;
    setLoading(true);
    const added: Source[] = [];
    const errs: string[] = [];

    for (const file of files) {
      const result = await decodeFile(file);
      if (!result.ok) {
        errs.push(result.message);
        continue;
      }
      added.push(result.source);
      try {
        await saveSource({
          id: result.source.id,
          name: result.source.name,
          blob: file,
          baseMidi: result.source.baseMidi,
          createdAt: result.source.createdAt,
        });
      } catch {
        errs.push(`「${result.source.name}」を保存できませんでした。再読み込みすると消える可能性があります。`);
      }
    }

    if (added.length > 0) {
      setSources((prev) => [...prev, ...added]);
      setSelectedId((cur) => cur ?? added[0].id);
    }
    setErrors(errs);
    setLoading(false);
  }

  function handleChangeBase(id: string, baseMidi: number) {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, baseMidi } : s)));
    updateBase(id, baseMidi).catch(() => {});
  }

  function handleRemove(id: string) {
    const target = sources.find((s) => s.id === id);
    if (!target) return;
    if (!window.confirm(`「${target.name}」を削除しますか?`)) return;

    const rest = sources.filter((s) => s.id !== id);
    setSources(rest);
    setAssignments((prev) => Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== id)));
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
    removeSource(id).catch(() => {});
  }

  function handleAssign(midi: number) {
    if (!selected) return;
    setAssignments((prev) => {
      const next = { ...prev };
      if (prev[midi] === selected.id) delete next[midi];
      else next[midi] = selected.id;
      return next;
    });
  }

  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) window.clearTimeout(playbackTimerRef.current);
      playbackRef.current?.stop(true);
    };
  }, []);

  async function handlePlayToggle() {
    if (playing && playbackRef.current) {
      if (playbackTimerRef.current) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      playbackRef.current.stop(true);
      playbackRef.current = null;
      setPlaying(false);
      return;
    }

    if (project.notes.length === 0) {
      setErrors(["再生する音符がありません。ピアノロールに音符を追加してください。"]);
      return;
    }

    try {
      const voices = await prepareVoices(project, sources);
      const ctx = getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      const session = startPlayback(ctx, project, voices, 0);
      playbackRef.current = session;
      setPlaying(true);

      const lastNote = project.notes.reduce((max, n) => Math.max(max, n.start + n.length), 0);
      const durationMs = ((lastNote * 60) / project.bpm + 1.5) * 1000;
      playbackTimerRef.current = window.setTimeout(() => {
        if (playbackRef.current === session) {
          playbackRef.current.stop(false);
          playbackRef.current = null;
          setPlaying(false);
        }
      }, durationMs);
    } catch (error) {
      setErrors([
        `再生に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`,
      ]);
    }
  }

  async function handleExport(format: "wav" | "mp3") {
    if (sources.length === 0) {
      setErrors(["音源を先に追加してください。"]);
      return;
    }
    if (project.notes.length === 0) {
      setErrors(["書き出す音符がありません。ピアノロールに音符を追加してください。"]);
      return;
    }

    try {
      const voices = await prepareVoices(project, sources);
      const rendered = await renderProject(project, sources, voices);
      const blob = format === "wav" ? encodeWav(rendered) : await encodeMp3(rendered, 192);
      downloadBlob(blob, `otostudio-${Date.now()}.${format === "wav" ? "wav" : "mp3"}`);
    } catch (error) {
      setErrors([
        `書き出しに失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`,
      ]);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>OtoStudio</h1>
        <span style={{ color: "var(--muted)" }}>無料・アカウント不要</span>
      </header>

      <SourceList
        sources={sources}
        selectedId={selectedId}
        loading={loading}
        errors={errors}
        onAddFiles={handleAddFiles}
        onSelect={setSelectedId}
        onRemove={handleRemove}
        onDismissErrors={() => setErrors([])}
      />

      <main className="main">
        <div className="tabs">
          <button className={view === "wave" ? "on" : ""} onClick={() => setView("wave")}>
            波形
          </button>
          <button className={view === "roll" ? "on" : ""} onClick={() => setView("roll")}>
            ピアノロール
          </button>
          <button className={`play-btn${playing ? " on" : ""}`} onClick={handlePlayToggle}>
            {playing ? "停止" : "再生"}
          </button>
        </div>
        {view === "wave" ? (
          <>
        {selected ? (
          <>
            <div className="wave-head">
              <strong>{selected.name}</strong>
              {mode === "single" && (
                <label className="base-select">
                  元の音が鳴る鍵盤
                  <select
                    value={selected.baseMidi}
                    onChange={(e) => handleChangeBase(selected.id, Number(e.target.value))}
                  >
                    {MIDI_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {noteName(m)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Waveform buffer={selected.buffer} />
          </>
        ) : (
          <div className="empty">音源を選ぶと波形がここに表示されます</div>
        )}</>
        ) : (
          <PianoRoll
            project={project}
            onChange={setProject}
            onExport={handleExport}
            activeMidi={activeMidi}
          />
        )}
      </main>

      <Keyboard
        mode={mode}
        onModeChange={setMode}
        selected={selected}
        sources={sources}
        assignments={assignments}
        onAssign={handleAssign}
        activeMidi={activeMidi}
        onMidiFocus={setActiveMidi}
      />
    </div>
  );
}
