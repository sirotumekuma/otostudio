import { clearSources, loadSources, saveSource, setMeta } from "@/lib/db";

type BackupSource = {
  id: string;
  name: string;
  baseMidi: number;
  createdAt: number;
  type: string;
  data: string; // base64
};

type BackupFile = {
  app: "OtoStudio";
  version: 1;
  savedAt: string;
  state: unknown;
  sources: BackupSource[];
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** 音源ファイルと設定をひとつのファイル(JSON)にまとめる */
export async function createBackup(state: unknown): Promise<Blob> {
  const stored = await loadSources();
  const sources: BackupSource[] = [];
  for (const s of stored) {
    sources.push({
      id: s.id,
      name: s.name,
      baseMidi: s.baseMidi,
      createdAt: s.createdAt,
      type: s.blob.type,
      data: await blobToBase64(s.blob),
    });
  }
  const file: BackupFile = { app: "OtoStudio", version: 1, savedAt: new Date().toISOString(), state, sources };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

/** バックアップファイルの内容でブラウザ内のデータを置き換える */
export async function restoreBackup(file: File): Promise<void> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("バックアップファイルを読み込めませんでした。");
  }
  if (!parsed || parsed.app !== "OtoStudio" || !Array.isArray(parsed.sources)) {
    throw new Error("OtoStudioのバックアップファイルではありません。");
  }
  await clearSources();
  for (const s of parsed.sources) {
    await saveSource({
      id: s.id,
      name: s.name,
      baseMidi: s.baseMidi,
      createdAt: s.createdAt,
      blob: base64ToBlob(s.data, s.type),
    });
  }
  await setMeta("state", parsed.state);
}
