const DB_NAME = "soundboard";
const STORE = "grids";
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveGrid(id, name, pads) {
  const db = await open();
  await req(tx(db, "readwrite").put({ id, name, pads, savedAt: Date.now() }));
  db.close();
}

export async function listGrids() {
  const db = await open();
  const all = await req(tx(db, "readonly").getAll());
  db.close();
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadGrid(id) {
  const db = await open();
  const row = await req(tx(db, "readonly").get(id));
  db.close();
  return row;
}

export async function deleteGrid(id) {
  const db = await open();
  await req(tx(db, "readwrite").delete(id));
  db.close();
}
