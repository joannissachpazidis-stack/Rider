'use strict';
// Kleine IndexedDB-Hülle. Alle Daten (inkl. Dateien) bleiben lokal im Browser.
const DB = (() => {
  const NAME = 'rider-ablage';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(NAME, VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('bands')) db.createObjectStore('bands', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('concerts')) db.createObjectStore('concerts', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('docs')) {
            db.createObjectStore('docs', { keyPath: 'id' }).createIndex('bandId', 'bandId');
          }
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }

  const req = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  async function store(name, mode = 'readonly') {
    return (await open()).transaction(name, mode).objectStore(name);
  }

  return {
    async all(name) { return req((await store(name)).getAll()); },
    async get(name, id) { return req((await store(name)).get(id)); },
    async put(name, obj) { await req((await store(name, 'readwrite')).put(obj)); return obj; },
    async del(name, id) { return req((await store(name, 'readwrite')).delete(id)); },
    async byIndex(name, index, value) { return req((await store(name)).index(index).getAll(value)); },
  };
})();
