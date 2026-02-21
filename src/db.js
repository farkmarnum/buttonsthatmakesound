const DB_NAME = "soundboard";
const GRIDS = "grids";
const META = "meta";
const VERSION = 2;

let cachedDb = null;

function open() {
  if (cachedDb) return Promise.resolve(cachedDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GRIDS))
        db.createObjectStore(GRIDS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META))
        db.createObjectStore(META);
    };
    req.onsuccess = () => {
      cachedDb = req.result;
      cachedDb.onclose = () => { cachedDb = null; };
      cachedDb.onversionchange = () => { cachedDb.close(); cachedDb = null; };
      resolve(cachedDb);
    };
    req.onerror = () => reject(req.error);
  });
}

function reqP(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveGrid(id, name, pads, fx) {
  const db = await open();
  await reqP(db.transaction(GRIDS, "readwrite").objectStore(GRIDS).put({ id, name, pads, fx, savedAt: Date.now() }));
}

export async function updateGrid(id, pads, fx) {
  const db = await open();
  const store = db.transaction(GRIDS, "readwrite").objectStore(GRIDS);
  const existing = await reqP(store.get(id));
  if (existing) {
    existing.pads = pads;
    existing.fx = fx;
    existing.savedAt = Date.now();
    await reqP(store.put(existing));
  }
}

export async function renameGrid(id, name) {
  const db = await open();
  const store = db.transaction(GRIDS, "readwrite").objectStore(GRIDS);
  const existing = await reqP(store.get(id));
  if (existing) {
    existing.name = name;
    await reqP(store.put(existing));
  }
}

export async function listGrids() {
  const db = await open();
  const all = await reqP(db.transaction(GRIDS, "readonly").objectStore(GRIDS).getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadGrid(id) {
  const db = await open();
  const row = await reqP(db.transaction(GRIDS, "readonly").objectStore(GRIDS).get(id));
  return row;
}

export async function deleteGrid(id) {
  const db = await open();
  await reqP(db.transaction(GRIDS, "readwrite").objectStore(GRIDS).delete(id));
}

export async function getActiveId() {
  const db = await open();
  const val = await reqP(db.transaction(META, "readonly").objectStore(META).get("activeGridId"));
  return val ?? null;
}

export async function setActiveId(id) {
  const db = await open();
  await reqP(db.transaction(META, "readwrite").objectStore(META).put(id, "activeGridId"));
}
