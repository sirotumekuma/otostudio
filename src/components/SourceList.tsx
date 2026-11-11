"use client";

import { useRef, useState } from "react";
import type { Source } from "@/lib/audio/types";
import { formatDuration } from "@/lib/audio/decode";

type Props = {
  sources: Source[];
  selectedId: string | null;
  loading: boolean;
  errors: string[];
  onAddFiles: (files: File[]) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDismissErrors: () => void;
};

export function SourceList({
  sources,
  selectedId,
  loading,
  errors,
  onAddFiles,
  onSelect,
  onRemove,
  onDismissErrors,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <aside className="sources">
      <p className="panel-title">音源一覧</p>

      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onAddFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {loading ? "読み込み中…" : "クリックまたはドラッグで音声を追加"}
        <br />
        <small>WAV / MP3 / OGG</small>
        <input
          ref={inputRef}
          type="file"
          accept=".wav,.mp3,.ogg,.m4a,audio/*"
          multiple
          hidden
          onChange={(e) => {
            onAddFiles(Array.from(e.target.files ?? []));
            e.target.value = ""; // 同じファイルを再選択できるように
          }}
        />
      </div>

      {errors.length > 0 && (
        <div className="error-box" role="alert">
          {errors.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
          <button onClick={onDismissErrors}>閉じる</button>
        </div>
      )}

      <ul className="source-list">
        {sources.map((s) => (
          <li
            key={s.id}
            className={s.id === selectedId ? "selected" : ""}
            onClick={() => onSelect(s.id)}
          >
            <div className="source-main"><span className="source-name">{s.name}</span>
            <span className="source-meta">
              {formatDuration(s.duration)} ・ {s.channels === 1 ? "モノラル" : "ステレオ"}
            </span></div>
            <button
              className="remove-btn"
              title="削除"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(s.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
