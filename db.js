'use strict';
// Lokale Datenbank (IndexedDB). Sie ist immer die Arbeitskopie, damit die App
// auch offline (z. B. in der Venue ohne Netz) funktioniert. Jede Änderung wird
// als "dirty" markiert und von cloud.js mit der Cloud abgeglichen.
const DB = (() => {
  const NAME = 'rider-ablage';
  const VERSION = 2;
  let dbp = null;
  const listeners = new Set();

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(NAME, VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('bands')) db.createObjectStore('bands', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('concerts')) db.createObjectStore('concerts', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('docs')) {
            db.createObjectStore('docs', { keyPath: 'id' }).createIndex('bandId', 'bandId');
          }
        };
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => { db.close(); location.reload(); }; // neue App-Version in anderem Tab
          resolve(db);
        };
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
  const alive = (o) => o && !o.deleted;

  // Rohzugriff ohne Sync-Markierung (für den Abgleich selbst)
  const raw = {
    async all(name) { return req((await store(name)).getAll()); },
    async get(name, id) { return req((await store(name)).get(id)); },
    async put(name, obj) { await req((await store(name, 'readwrite')).put(obj)); return obj; },
    async del(name, id) { return req((await store(name, 'readwrite')).delete(id)); },
    async clear(name) { return req((await store(name, 'readwrite')).clear()); },
  };

  function changed(name, obj) { listeners.forEach((f) => f(name, obj)); }

  return {
    STORES: ['bands', 'concerts', 'docs', 'profiles'],
    raw,
    onChange(fn) { listeners.add(fn); },
    async all(name) { return (await raw.all(name)).filter(alive); },
    async get(name, id) { const o = await raw.get(name, id); return alive(o) ? o : undefined; },
    async byIndex(name, index, value) { return (await req((await store(name)).index(index).getAll(value))).filter(alive); },
    async put(name, obj) {
      obj.updatedAt = new Date().toISOString();
      obj.dirty = true;
      await raw.put(name, obj);
      changed(name, obj);
      return obj;
    },
    // Löschen hinterlässt einen "Grabstein", damit die Löschung auch auf andere Geräte kommt.
    async del(name, id) {
      const old = await raw.get(name, id);
      if (!old) return;
      const tomb = { id, deleted: true, dirty: true, updatedAt: new Date().toISOString(), bandId: old.bandId ?? null };
      // Für den Abgleich nötig: wer etwas sehen darf und wo die Datei liegt
      for (const k of ['festivalId', 'owner', 'sharedWith', 'filePath', '_synced']) if (old[k] !== undefined) tomb[k] = old[k];
      await raw.put(name, tomb);
      changed(name, tomb);
    },
  };
})();
