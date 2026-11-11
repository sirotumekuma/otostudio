"use client";

import type { Project, Track } from "@/lib/project";
import { MAX_TRACKS, TRACK_COLORS } from "@/lib/project";

type Props = {
  project: Project;
  onChange: (updater: (p: Project) => Project) => void;
  onSelectTrack: (id: string) => void;
  onAddTrack: () => void;
  onRemoveTrack: (id: string) => void;
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {label}
        <em>{text}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// ローパスは対数的に動かす(200Hz〜20000Hz。右端でオフ)
const lpToSlider = (f: number) => Math.log(f / 200) / Math.log(100);
const sliderToLp = (v: number) => (v >= 0.99 ? 20000 : Math.round(200 * Math.pow(100, v)));

export function Mixer({ project, onChange, onSelectTrack, onAddTrack, onRemoveTrack }: Props) {
  const { tracks, activeTrackId, master } = project;

  function updateTrack(id: string, patch: Partial<Track>) {
    onChange((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  return (
    <div className="mixer">
      <div className="mixer-strips">
        {tracks.map((t, i) => (
          <div
            key={t.id}
            className={`strip${t.id === activeTrackId ? " active" : ""}`}
            style={{ borderTopColor: TRACK_COLORS[i % TRACK_COLORS.length] }}
            onClick={() => onSelectTrack(t.id)}
          >
            <input
              className="strip-name"
              value={t.name}
              maxLength={20}
              onChange={(e) => updateTrack(t.id, { name: e.target.value })}
            />
            <div className="ms">
              <button className={t.mute ? "on mute" : ""} onClick={() => updateTrack(t.id, { mute: !t.mute })}>
                M
              </button>
              <button className={t.solo ? "on solo" : ""} onClick={() => updateTrack(t.id, { solo: !t.solo })}>
                S
              </button>
            </div>
            <Slider label="音量" value={t.volume} min={0} max={1.2} step={0.01} text={`${Math.round(t.volume * 100)}%`} onChange={(v) => updateTrack(t.id, { volume: v })} />
            <Slider label="パン" value={t.pan} min={-1} max={1} step={0.05} text={t.pan === 0 ? "中央" : t.pan < 0 ? `左${Math.round(-t.pan * 100)}` : `右${Math.round(t.pan * 100)}`} onChange={(v) => updateTrack(t.id, { pan: v })} />
            <p className="strip-sub">エフェクト</p>
            <Slider label="ディレイ" value={t.delay} min={0} max={1} step={0.01} text={`${Math.round(t.delay * 100)}%`} onChange={(v) => updateTrack(t.id, { delay: v })} />
            <Slider label="リバーブ" value={t.reverb} min={0} max={1} step={0.01} text={`${Math.round(t.reverb * 100)}%`} onChange={(v) => updateTrack(t.id, { reverb: v })} />
            <Slider label="ローパス" value={lpToSlider(t.lowpass)} min={0} max={1} step={0.01} text={t.lowpass >= 20000 ? "オフ" : `${t.lowpass}Hz`} onChange={(v) => updateTrack(t.id, { lowpass: sliderToLp(v) })} />
            <p className="strip-sub">再生</p>
            <label className="check">
              <input type="checkbox" checked={t.stretch} onChange={(e) => updateTrack(t.id, { stretch: e.target.checked })} />
              時間を維持してピッチ変更
            </label>
            <label className="check">
              <input type="checkbox" checked={t.gate} onChange={(e) => updateTrack(t.id, { gate: e.target.checked })} />
              音符の長さで音を止める
            </label>
            {tracks.length > 1 && (
              <button
                className="strip-del"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveTrack(t.id);
                }}
              >
                トラック削除
              </button>
            )}
          </div>
        ))}

        <div className="strip master">
          <p className="strip-title">マスター</p>
          <Slider label="音量" value={master} min={0} max={1} step={0.01} text={`${Math.round(master * 100)}%`} onChange={(v) => onChange((p) => ({ ...p, master: v }))} />
          <button className="strip-add" onClick={onAddTrack} disabled={tracks.length >= MAX_TRACKS}>
            ＋ トラック追加
          </button>
        </div>
      </div>
      <p className="mixer-note">設定の変更は、次の再生・書き出しから反映されます。</p>
    </div>
  );
}
