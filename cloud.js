'use strict';
// Cloud-Abgleich über Supabase (Datenbank + Dateispeicher + Login).
// Spricht direkt die REST-Schnittstellen an, damit keine Bibliothek nötig ist.
const Cloud = (() => {
  const BUCKET = 'riders';
  const KIND = { bands: 'band', concerts: 'concert', docs: 'doc' };
  const STORE = { band: 'bands', concert: 'concerts', doc: 'docs' };
  const LS = { cfg: 'cloud.cfg', session: 'cloud.session', lastPull: 'cloud.lastPull', lastSync: 'cloud.lastSync' };

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const preset = window.CLOUD_CONFIG && window.CLOUD_CONFIG.url && window.CLOUD_CONFIG.key ? window.CLOUD_CONFIG : null;
  let cfg = read(LS.cfg) || preset;
  let session = read(LS.session);
  let state = 'off';
  let lastError = '';
  const listeners = new Set();
  const remoteListeners = new Set();

  const setState = (s, err = '') => { state = s; lastError = err; listeners.forEach((f) => f(state, lastError)); };
  const configured = () => !!(cfg && cfg.url && cfg.key);
  const loggedIn = () => configured() && !!session?.access_token;
  const userId = () => session?.user?.id;
  const base = () => cfg.url.replace(/\/+$/, '');

  function saveSession(s) {
    if (s && !s.expires_at && s.expires_in) s.expires_at = Math.floor(Date.now() / 1000) + s.expires_in;
    session = s;
    if (s) localStorage.setItem(LS.session, JSON.stringify(s));
    else localStorage.removeItem(LS.session);
  }

  async function api(path, { method = 'GET', headers = {}, body, auth = true, raw = false } = {}) {
    if (auth) await ensureToken();
    const h = { apikey: cfg.key, Authorization: 'Bearer ' + (auth ? session.access_token : cfg.key), ...headers };
    if (body !== undefined && !(body instanceof Blob)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const r = await fetch(base() + path, { method, headers: h, body });
    if (!r.ok) {
      let msg = r.statusText;
      try { const j = await r.json(); msg = j.msg || j.message || j.error_description || j.error || JSON.stringify(j); } catch { /* egal */ }
      if (r.status === 401 && auth) { saveSession(null); setState('loggedout', 'Sitzung abgelaufen – bitte neu anmelden'); }
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
    if (raw) return r;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  let refreshing = null;
  async function ensureToken() {
    if (!session) throw new Error('Nicht angemeldet');
    if (session.expires_at * 1000 - Date.now() > 60000) return;
    refreshing ||= api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false })
      .then(saveSession)
      .finally(() => { refreshing = null; });
    await refreshing;
  }

  /* ---------- Abgleich ---------- */
  const strip = (rec) => { const { blob, dirty, ...rest } = rec; return rest; };
  const filePath = (id) => `${userId()}/${id}`;

  async function push() {
    const dirty = [];
    for (const s of DB.STORES) for (const r of await DB.raw.all(s)) if (r.dirty) dirty.push([s, r]);
    if (!dirty.length) return 0;

    // Dateien zuerst hochladen, damit kein Eintrag ohne Datei in der Cloud steht
    for (const [s, r] of dirty) {
      if (s === 'docs' && !r.deleted && r.blob && !r.fileUploaded) {
        await api(`/storage/v1/object/${BUCKET}/${filePath(r.id)}`, {
          method: 'POST', body: r.blob, headers: { 'x-upsert': 'true', 'Content-Type': r.mime || 'application/octet-stream' },
        });
        r.fileUploaded = true;
        const cur = await DB.raw.get(s, r.id);
        if (cur) { cur.fileUploaded = true; await DB.raw.put(s, cur); }
      }
    }
    const rows = dirty.map(([s, r]) => ({
      id: r.id, user_id: userId(), kind: KIND[s], deleted: !!r.deleted, data: r.deleted ? null : strip(r),
    }));
    for (let i = 0; i < rows.length; i += 100) {
      await api('/rest/v1/items?on_conflict=user_id,id', {
        method: 'POST', body: rows.slice(i, i + 100), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
    for (const [s, r] of dirty) {
      const cur = await DB.raw.get(s, r.id);
      if (!cur || cur.updatedAt !== r.updatedAt) continue; // inzwischen erneut geändert → nächster Durchlauf
      if (cur.deleted) {
        await DB.raw.del(s, r.id);
        if (s === 'docs') api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [filePath(r.id)] } }).catch(() => {});
      } else {
        cur.dirty = false;
        await DB.raw.put(s, cur);
      }
    }
    return dirty.length;
  }

  async function pull() {
    let since = localStorage.getItem(LS.lastPull) || '1970-01-01T00:00:00Z';
    let changed = 0;
    for (;;) {
      const rows = await api(`/rest/v1/items?select=id,kind,data,deleted,updated_at&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`);
      for (const row of rows) {
        since = row.updated_at;
        const s = STORE[row.kind];
        if (!s) continue;
        const local = await DB.raw.get(s, row.id);
        if (local?.dirty && (local.updatedAt || '') > (row.data?.updatedAt || '')) continue; // lokal neuer
        if (row.deleted) {
          if (local) { await DB.raw.del(s, row.id); changed++; }
          continue;
        }
        if (local && !local.dirty && local.updatedAt === row.data.updatedAt) continue; // schon bekannt
        const rec = { ...row.data, dirty: false };
        if (s === 'docs') {
          rec.blob = local?.blob && local.fileHash && local.fileHash === rec.fileHash ? local.blob : null;
          rec.fileUploaded = true;
        }
        await DB.raw.put(s, rec);
        changed++;
      }
      localStorage.setItem(LS.lastPull, since);
      if (rows.length < 500) break;
    }
    return changed;
  }

  // Dateien im Hintergrund laden, damit alles auch offline verfügbar ist.
  let prefetching = false;
  async function prefetch() {
    if (prefetching) return;
    prefetching = true;
    try {
      for (const d of await DB.raw.all('docs')) {
        if (!d.deleted && d.fileName && !d.blob && loggedIn() && navigator.onLine) {
          try { await fetchFile(d); } catch { /* später nochmal */ }
        }
      }
    } finally { prefetching = false; }
  }

  async function fetchFile(doc) {
    const r = await api(`/storage/v1/object/${BUCKET}/${filePath(doc.id)}`, { raw: true });
    const blob = new Blob([await r.blob()], { type: doc.mime || 'application/octet-stream' });
    const cur = await DB.raw.get('docs', doc.id);
    if (cur && !cur.deleted) { cur.blob = blob; await DB.raw.put('docs', cur); }
    return blob;
  }

  let running = null;
  let again = false;
  function sync() {
    if (!loggedIn()) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        if (!navigator.onLine) { setState('offline'); return; }
        setState('syncing');
        try {
          // Erst holen, dann senden: bei Konflikten gewinnt die jüngere Änderung.
          const changed = await pull();
          await push();
          localStorage.setItem(LS.lastSync, new Date().toISOString());
          setState('ok');
          if (changed) remoteListeners.forEach((f) => f(changed));
          prefetch();
        } catch (e) {
          if (state !== 'loggedout') setState(navigator.onLine ? 'error' : 'offline', e.message);
          return;
        }
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  let timer = null;
  function schedule(ms = 1500) {
    if (!loggedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(sync, ms);
  }

  DB.onChange(() => schedule());
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => loggedIn() && setState('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);

  // Einrichtungslink (?cloud=...) für weitere Geräte
  try {
    const p = new URLSearchParams(location.search).get('cloud');
    if (p) {
      const c = JSON.parse(decodeURIComponent(escape(atob(p))));
      if (c.url && c.key) { cfg = { url: c.url, key: c.key }; localStorage.setItem(LS.cfg, JSON.stringify(cfg)); }
      history.replaceState(null, '', location.pathname + (location.hash || '#/more'));
    }
  } catch { /* ungültiger Link */ }

  if (!configured()) state = 'off';
  else if (!loggedIn()) state = 'loggedout';
  else state = navigator.onLine ? 'ok' : 'offline';

  return {
    get state() { return state; },
    get error() { return lastError; },
    get email() { return session?.user?.email || ''; },
    get config() { return cfg; },
    get lastSync() { return localStorage.getItem(LS.lastSync); },
    configured, loggedIn, sync, schedule, fetchFile,
    onState(fn) { listeners.add(fn); },
    onRemoteChange(fn) { remoteListeners.add(fn); },
    configure(url, key) {
      url = url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      cfg = { url, key: key.trim() };
      localStorage.setItem(LS.cfg, JSON.stringify(cfg));
      saveSession(null);
      localStorage.removeItem(LS.lastPull);
      setState('loggedout');
    },
    resetConfig() {
      localStorage.removeItem(LS.cfg);
      saveSession(null);
      localStorage.removeItem(LS.lastPull);
      cfg = preset;
      setState(configured() ? 'loggedout' : 'off');
    },
    setupLink() {
      const enc = btoa(unescape(encodeURIComponent(JSON.stringify({ url: cfg.url, key: cfg.key }))));
      return location.origin + location.pathname + '?cloud=' + enc + '#/more';
    },
    async signIn(email, password) {
      const s = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
      saveSession(s);
      localStorage.removeItem(LS.lastPull);
      // Alles Lokale einmal hochladen (z. B. Daten von vor der Cloud-Einrichtung)
      for (const st of DB.STORES) for (const r of await DB.raw.all(st)) if (!r.dirty) { r.dirty = true; await DB.raw.put(st, r); }
      setState('ok');
      await sync();
    },
    async signUp(email, password) {
      const s = await api('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false });
      if (s?.access_token) { await this.signIn(email, password); return 'ok'; }
      return 'confirm';
    },
    async signOut() {
      try { await api('/auth/v1/logout', { method: 'POST' }); } catch { /* egal */ }
      saveSession(null);
      localStorage.removeItem(LS.lastPull);
      setState('loggedout');
    },
  };
})();
