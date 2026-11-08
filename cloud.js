'use strict';
// Cloud-Abgleich über Supabase (Datenbank + Dateispeicher + Login).
// Spricht direkt die REST-Schnittstellen an, damit keine Bibliothek nötig ist.
const Cloud = (() => {
  const BUCKET = 'riders';
  // Stagebox-Profile laufen unter der Art 'band' mit Markierung _store, damit die bestehende Tabelle ohne Änderung passt.
  const KIND = { bands: 'band', concerts: 'concert', docs: 'doc', profiles: 'band' };
  const STORE = { band: 'bands', concert: 'concerts', doc: 'docs' };
  const LS = { cfg: 'cloud.cfg', session: 'cloud.session', lastPull: 'cloud.lastPull', lastSync: 'cloud.lastSync', lastUser: 'cloud.lastUser', team: 'cloud.team' };

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const preset = window.CLOUD_CONFIG && window.CLOUD_CONFIG.url && window.CLOUD_CONFIG.key ? window.CLOUD_CONFIG : null;
  // Aus beliebigen Eingaben die reine Project URL machen, z. B.
  //   https://xyz.supabase.co/rest/v1/   → https://xyz.supabase.co
  //   https://supabase.com/dashboard/project/xyz/settings/api → https://xyz.supabase.co
  //   xyz (nur die Projekt-ID)           → https://xyz.supabase.co
  function normalizeUrl(input) {
    let s = String(input || '').trim().replace(/^["'<\s]+|["'>\s]+$/g, '');
    if (/^[a-z0-9]{15,30}$/i.test(s)) return `https://${s.toLowerCase()}.supabase.co`;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch { return s.replace(/\/+$/, ''); }
    const ref = u.pathname.match(/\/project\/([a-z0-9]{15,30})/i);
    if (/(^|\.)supabase\.com$/i.test(u.hostname) && ref) return `https://${ref[1].toLowerCase()}.supabase.co`;
    return u.origin;
  }
  const cleanKey = (k) => String(k || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  const fixCfg = (c) => (c && c.url ? { url: normalizeUrl(c.url), key: cleanKey(c.key) } : c);

  let cfg = fixCfg(read(LS.cfg) || preset);
  if (cfg) localStorage.getItem(LS.cfg) && localStorage.setItem(LS.cfg, JSON.stringify(cfg));
  let session = read(LS.session);
  if (session?.user?.id && !localStorage.getItem(LS.lastUser)) localStorage.setItem(LS.lastUser, session.user.id);
  let team = read(LS.team) || [];
  let state = 'off';
  let lastError = '';
  const listeners = new Set();
  const remoteListeners = new Set();

  const setState = (s, err = '') => { state = s; lastError = err; listeners.forEach((f) => f(state, lastError)); };
  function atobSafe(x) { try { return atob(String(x || '').replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } }
  const configured = () => !!(cfg && cfg.url && cfg.key);
  const loggedIn = () => configured() && !!session?.access_token;
  const userId = () => session?.user?.id;
  const myEmail = () => String(session?.user?.email || '').toLowerCase();
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
  const strip = (rec) => { const { blob, dirty, _synced, ...rest } = rec; return rest; };
  // Dateien liegen im Ordner der Person, die sie hochgeladen hat.
  const filePath = (doc) => doc.filePath || `${userId()}/${doc.id}`;

  // Wer ein Konzert sehen darf: wer es angelegt hat + geteilte Personen ('*' = ganzes Team).
  // Festival-Tage übernehmen das vom Festival.
  async function shareList(r) {
    const src = (r.festivalId && (await DB.raw.get('concerts', r.festivalId))) || r;
    const list = new Set((src.sharedWith || []).map((e) => String(e).toLowerCase()));
    if (src.owner) list.add(src.owner);
    return [...list];
  }

  // Gehöre ich zum Team? Holt dabei auch die Team-Liste. Ist das Team noch leer, trägt sich die erste Person selbst ein.
  async function checkMember() {
    const me = myEmail();
    let list;
    try {
      list = (await api('/rest/v1/members?select=email&order=email')).map((m) => m.email);
    } catch (e) {
      if (e.status === 404 || /members|relation|schema cache/i.test(e.message)) {
        throw new Error('Die Datenbank ist noch nicht auf dem Team-Stand: Bitte supabase/schema.sql im Supabase „SQL Editor“ erneut ausführen.');
      }
      throw e;
    }
    if (!list.length) {
      try { await api('/rest/v1/members', { method: 'POST', body: { email: me }, headers: { Prefer: 'return=minimal' } }); list = [me]; } catch { /* Team ist nicht leer */ }
    }
    team = list;
    localStorage.setItem(LS.team, JSON.stringify(team));
    return team.includes(me);
  }

  async function push() {
    const dirty = [];
    for (const s of DB.STORES) for (const r of await DB.raw.all(s)) if (r.dirty) dirty.push([s, r]);
    if (!dirty.length) return 0;

    for (const [s, r] of dirty) {
      // Neue Konzerte gehören der Person, die sie angelegt hat
      if (s === 'concerts' && !r.deleted && !r.owner) {
        r.owner = myEmail();
        const cur = await DB.raw.get(s, r.id);
        if (cur) { cur.owner = r.owner; await DB.raw.put(s, cur); }
      }
      // Dateien zuerst hochladen, damit kein Eintrag ohne Datei in der Cloud steht
      if (s === 'docs' && !r.deleted && r.blob && !r.fileUploaded) {
        r.filePath ||= `${userId()}/${r.id}`;
        await api(`/storage/v1/object/${BUCKET}/${r.filePath}`, {
          method: 'POST', body: r.blob, headers: { 'x-upsert': 'true', 'Content-Type': r.mime || 'application/octet-stream' },
        });
        r.fileUploaded = true;
        const cur = await DB.raw.get(s, r.id);
        if (cur) { cur.fileUploaded = true; cur.filePath = r.filePath; await DB.raw.put(s, cur); }
      }
    }
    const rows = [];
    for (const [s, r] of dirty) {
      rows.push({
        id: r.id, kind: KIND[s], deleted: !!r.deleted, shared_with: s === 'concerts' ? await shareList(r) : [],
        data: r.deleted ? (s === 'profiles' ? { _store: s } : null) : (s === 'profiles' ? { ...strip(r), _store: s } : strip(r)),
      });
    }
    for (let i = 0; i < rows.length; i += 100) {
      await api('/rest/v1/items?on_conflict=id', {
        method: 'POST', body: rows.slice(i, i + 100), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
    for (const [s, r] of dirty) {
      const cur = await DB.raw.get(s, r.id);
      if (!cur || cur.updatedAt !== r.updatedAt) continue; // inzwischen erneut geändert → nächster Durchlauf
      if (cur.deleted) {
        await DB.raw.del(s, r.id);
        if (s === 'docs') api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [filePath(r)] } }).catch(() => {});
      } else {
        cur.dirty = false;
        cur._synced = true;
        await DB.raw.put(s, cur);
      }
    }
    return dirty.length;
  }

  async function pull() {
    let since = localStorage.getItem(LS.lastPull) || '1970-01-01T00:00:00Z';
    let changed = 0;
    for (;;) {
      const rows = await api(`/rest/v1/items?select=id,user_id,kind,data,deleted,updated_at&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`);
      for (const row of rows) {
        since = row.updated_at;
        const s = row.data?._store || STORE[row.kind];
        if (!s || !DB.STORES.includes(s)) continue;
        const local = await DB.raw.get(s, row.id);
        if (local?.dirty && (local.updatedAt || '') > (row.data?.updatedAt || '')) continue; // lokal neuer
        if (row.deleted) {
          if (local) { await DB.raw.del(s, row.id); changed++; }
          continue;
        }
        if (local && !local.dirty && local.updatedAt === row.data.updatedAt) continue; // schon bekannt
        const rec = { ...row.data, dirty: false, _synced: true };
        delete rec._store;
        if (s === 'docs') {
          rec.filePath ||= `${row.user_id}/${row.id}`;
          rec.blob = local?.blob && local.fileHash && local.fileHash === rec.fileHash ? local.blob : null;
          rec.fileUploaded = true;
        }
        await DB.raw.put(s, rec);
        changed++;
      }
      localStorage.setItem(LS.lastPull, since);
      if (rows.length < 500) break;
    }
    return changed + (await prune());
  }

  // Konzerte, die nicht (mehr) mit mir geteilt sind, vom Gerät entfernen
  async function prune() {
    const visible = new Set();
    for (let off = 0; ; off += 1000) {
      const rows = await api(`/rest/v1/items?select=id&kind=eq.concert&order=id&limit=1000&offset=${off}`);
      rows.forEach((r) => visible.add(r.id));
      if (rows.length < 1000) break;
    }
    let n = 0;
    for (const c of await DB.raw.all('concerts')) {
      if (visible.has(c.id) || (c.dirty && !c._synced)) continue; // sichtbar oder neu und noch nicht hochgeladen
      await DB.raw.del('concerts', c.id);
      n++;
    }
    return n;
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
    const r = await api(`/storage/v1/object/${BUCKET}/${filePath(doc)}`, { raw: true });
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
          if (!(await checkMember())) { setState('notmember'); return; }
          // Erst holen, dann senden: bei Konflikten gewinnt die jüngere Änderung.
          const changed = await pull();
          await push();
          localStorage.setItem(LS.lastSync, new Date().toISOString());
          setState('ok');
          if (changed) remoteListeners.forEach((f) => f(changed));
          prefetch();
        } catch (e) {
          if (state !== 'loggedout' && state !== 'notmember') setState(navigator.onLine ? 'error' : 'offline', e.message);
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
    get myEmail() { return myEmail(); },
    get team() { return team; },
    configured, loggedIn, sync, schedule, fetchFile,
    async addMember(email) {
      email = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
      await api('/rest/v1/members', { method: 'POST', body: { email }, headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' } });
      await checkMember();
    },
    async removeMember(email) {
      await api('/rest/v1/members?email=eq.' + encodeURIComponent(email), { method: 'DELETE' });
      await checkMember();
    },
    onState(fn) { listeners.add(fn); },
    onRemoteChange(fn) { remoteListeners.add(fn); },
    // Prüft die Verbindung, bevor sie gespeichert wird. Gibt bei Problemen eine verständliche Meldung zurück.
    async configure(url, key) {
      const next = { url: normalizeUrl(url), key: cleanKey(key) };
      if (!next.key) return 'Bitte den anon / publishable key eintragen.';
      if (/service_role/.test(atobSafe(next.key.split('.')[1])) || /^sb_secret_/.test(next.key)) {
        return 'Das ist der geheime service_role / secret Key. Bitte den „anon“ bzw. „publishable“ Key nehmen – der geheime darf nicht in die App.';
      }
      try {
        const r = await fetch(next.url + '/auth/v1/settings', { headers: { apikey: next.key, Authorization: 'Bearer ' + next.key } });
        if (r.status === 401 || r.status === 403) return 'Der Key passt nicht zu diesem Projekt. Bitte den „anon / publishable“ Key aus Project Settings → API kopieren.';
        if (!r.ok) return `Unter ${next.url} antwortet kein Supabase-Projekt (Fehler ${r.status}). Bitte die Project URL prüfen – sie sieht aus wie https://xxxx.supabase.co`;
        const t = await fetch(next.url + '/rest/v1/items?select=id&limit=1', { headers: { apikey: next.key, Authorization: 'Bearer ' + next.key } });
        if (t.status === 404 || t.status === 400) {
          const j = await t.json().catch(() => ({}));
          if (/items|relation|schema cache/i.test(j.message || '')) return 'Verbindung klappt, aber die Tabelle fehlt noch: Bitte im Supabase „SQL Editor“ den Inhalt von supabase/schema.sql ausführen.';
        }
      } catch {
        return `${next.url} ist nicht erreichbar. Bitte die Project URL prüfen (https://xxxx.supabase.co) und ob Internet da ist.`;
      }
      cfg = next;
      localStorage.setItem(LS.cfg, JSON.stringify(cfg));
      saveSession(null);
      localStorage.removeItem(LS.lastPull);
      setState('loggedout');
      return '';
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
      // Anderes Konto als zuletzt auf diesem Gerät → lokale Daten verwerfen, damit nichts ins fremde Konto wandert
      const prev = localStorage.getItem(LS.lastUser);
      if (prev && s.user?.id && prev !== s.user.id) {
        for (const st of DB.STORES) await DB.raw.clear(st);
        team = [];
        localStorage.removeItem(LS.team);
      }
      if (s.user?.id) localStorage.setItem(LS.lastUser, s.user.id);
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
