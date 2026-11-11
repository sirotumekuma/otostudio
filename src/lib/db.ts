// IndexedDBの小さなラッパー(ブラウザ内ローカル保存用)。
// 必ずブラウザ側(useEffectやイベント内)から呼ぶこと。

const DB_NAME = "otostudio";
const DB_VERSION = 1;
const SOURCES = "sources";
const META = "meta";

export type StoredSource = {
  id: string;
  name: string;
  blob: Blob; // 元の音声ファイル
  baseMidi: number;
  createdAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SOURCES)) {
          db.createObjectStore(SOURCES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStore(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

export async function saveSource(s: StoredSource): Promise<void> {
  await request((await getStore(SOURCES, "readwrite")).put(s));
}

export async function loadSources(): Promise<StoredSource[]> {
  const all = (await request((await getStore(SOURCES, "readonly")).getAll())) as StoredSource[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function clearSources(): Promise<void> {
  await request((await getStore(SOURCES, "readwrite")).clear());
}

export async function removeSource(id: string): Promise<void> {
  await request((await getStore(SOURCES, "readwrite")).delete(id));
}

export async function updateBase(id: string, baseMidi: number): Promise<void> {
  const store = await getStore(SOURCES, "readwrite");
  await new Promise<void>((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const cur = getReq.result as StoredSource | undefined;
      if (!cur) return resolve();
      const putReq = store.put({ ...cur, baseMidi });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getMeta(key: string): Promise<unknown> {
  return request((await getStore(META, "readonly")).get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await request((await getStore(META, "readwrite")).put(value, key));
}
