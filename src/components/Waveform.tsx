"use client";

import { useEffect, useRef } from "react";

export function Waveform({ buffer }: { buffer: AudioBuffer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);

      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // 中心線
      g.fillStyle = "#323843";
      g.fillRect(0, h / 2, w, 1);

      // 1ピクセル幅ごとに、その区間の最小値〜最大値を縦線で描く
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        channels.push(buffer.getChannelData(c));
      }
      const len = buffer.length;
      const step = len / w;
      g.fillStyle = "#5b8cff";

      for (let x = 0; x < w; x++) {
        const start = Math.floor(x * step);
        const end = Math.min(len, Math.max(start + 1, Math.floor((x + 1) * step)));
        let min = 0;
        let max = 0;
        for (const data of channels) {
          for (let i = start; i < end; i++) {
            const v = data[i];
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        const y1 = ((1 - max) * h) / 2;
        const y2 = ((1 - min) * h) / 2;
        g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [buffer]);

  return <canvas ref={canvasRef} className="waveform" />;
}
