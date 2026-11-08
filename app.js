'use strict';

/* ======================================================================
   Rider-Ablage – Techrider & Unterlagen zu Bands, zugeordnet zu Konzerten
   ====================================================================== */

const DOC_TYPES = [
  'Techrider', 'Inputliste', 'Stageplot', 'Monitoring', 'Lichtrider',
  'Hospitality', 'Kontakte', 'Notizen', 'Sonstiges',
];
const OLD_AFTER_DAYS = 365; // ab wann ein Rider als "alt?" markiert wird

/* ---------------- Helfer ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const nowIso = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const toDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00' : iso) : null);
const fmtDate = (iso) => (iso ? toDate(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const fmtWeekday = (iso) => (iso ? toDate(iso).toLocaleDateString('de-DE', { weekday: 'short' }) : '');
const ageDays = (iso) => (iso ? Math.floor((Date.now() - toDate(iso).getTime()) / 86400000) : 0);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
const fmtSize = (n) => (!n ? '' : n < 1024 ? '< 1 KB' : n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB');
const byName = (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

function toast(msg) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

/* ---------------- Daten ---------------- */
const Data = {
  bands: () => DB.all('bands'),
  concerts: () => DB.all('concerts'),
  docs: () => DB.all('docs'),
  docsOfBand: (bandId) => DB.byIndex('docs', 'bandId', bandId),

  async findBandByName(name) {
    const n = norm(name);
    return (await this.bands()).find((b) => norm(b.name) === n) || null;
  },
  async findOrCreateBand(name) {
    name = name.trim();
    const existing = await this.findBandByName(name);
    if (existing) return { band: existing, created: false };
    const band = { id: uid(), name, genre: '', contact: '', notes: '', createdAt: nowIso() };
    await DB.put('bands', band);
    return { band, created: true };
  },
  async deleteDoc(id) {
    await DB.del('docs', id);
    for (const c of await this.concerts()) {
      let changed = false;
      for (const e of c.lineup) {
        if (e.docIds.includes(id)) { e.docIds = e.docIds.filter((x) => x !== id); changed = true; }
      }
      if (changed) await DB.put('concerts', c);
    }
  },
  async deleteBand(id) {
    for (const d of await this.docsOfBand(id)) await DB.del('docs', d.id);
    for (const c of await this.concerts()) {
      if (c.lineup.some((e) => e.bandId === id)) {
        c.lineup = c.lineup.filter((e) => e.bandId !== id);
        await DB.put('concerts', c);
      }
    }
    await DB.del('bands', id);
  },
};

const isOld = (d) => ageDays(d.confirmedAt || d.date || d.createdAt) > OLD_AFTER_DAYS;

function docMeta(d) {
  const p = [];
  if (d.date) p.push('Stand ' + fmtDate(d.date));
  if (d.confirmedAt) p.push('bestätigt ' + fmtDate(d.confirmedAt));
  if (d.fileName) p.push(esc(d.fileName) + (d.size ? ' (' + fmtSize(d.size) + ')' : ''));
  else p.push('nur Notiz');
  if (d.fileName && !d.blob) p.push('☁︎');
  return p.join(' · ');
}
function docBadges(d) {
  if (d.archived) return '<span class="badge warn">veraltet</span>';
  if (isOld(d)) return `<span class="badge warn" title="Seit über ${OLD_AFTER_DAYS} Tagen nicht bestätigt">alt?</span>`;
  return '';
}
const typeBadge = (t) => `<span class="badge type t-${norm(t)}">${esc(t)}</span>`;

/* ---------------- Modal ---------------- */
function modal(html, setup) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    const el = wrap.firstElementChild;
    let finished = false;
    const done = (v) => {
      if (finished) return;
      finished = true;
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('no-scroll');
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && wrap === [...$$('.modal-backdrop')].pop()) done(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
    $$('[data-close]', el).forEach((b) => (b.onclick = () => done(null)));
    setup?.(el, done);
    const f = $('[autofocus]', el);
    if (f && matchMedia('(pointer:fine)').matches) f.focus();
  });
}

function confirmDialog(text, ok = 'OK', danger = false) {
  return modal(`<p>${text}</p><div class="actions"><button class="ghost" data-close>Abbrechen</button><button class="${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div>`,
    (el, done) => ($('[data-ok]', el).onclick = () => done(true)));
}

/* ---------------- Dokument-Vorschau ---------------- */
async function previewDoc(id) {
  const d = await DB.get('docs', id);
  if (!d) return;
  const band = await DB.get('bands', d.bandId);
  let url = null;
  let body = '';
  if (!d.blob && d.fileName && Cloud.loggedIn()) {
    const pr = Smart.progress('Lade Datei aus der Cloud …');
    try { d.blob = await Cloud.fetchFile(d); } catch { /* unten Hinweis */ } finally { pr.close(); }
  }
  if (!d.blob && d.fileName) body = '<p class="warn-text">Die Datei ist auf diesem Gerät noch nicht verfügbar. Melde dich in der Cloud an bzw. warte, bis die Synchronisierung fertig ist.</p>';
  if (d.blob) {
    url = URL.createObjectURL(d.blob);
    if (d.mime?.startsWith('image/')) body = `<img class="preview" src="${url}" alt="">`;
    else if (d.mime === 'application/pdf') body = `<iframe class="preview" src="${url}" title="Vorschau"></iframe>`;
    else if (d.mime?.startsWith('text/') || /\.(txt|csv|md)$/i.test(d.fileName)) body = `<pre class="preview">${esc(await d.blob.text())}</pre>`;
    else body = '<p class="muted">Für diesen Dateityp gibt es keine Vorschau – bitte öffnen oder herunterladen.</p>';
  }
  await modal(`
    <div class="modal-head">
      <div>${typeBadge(d.type)} ${docBadges(d)}<h2>${esc(d.title)}</h2>
      <div class="muted small">${band ? esc(band.name) + ' · ' : ''}${docMeta(d)}</div></div>
      <button class="icon" data-close aria-label="Schließen">✕</button>
    </div>
    ${d.notes ? `<div class="notes">${esc(d.notes)}</div>` : ''}
    ${body}
    <div class="actions">
      ${url ? `<a class="button ghost" href="${url}" download="${esc(d.fileName)}">Download</a>
               <a class="button primary" href="${url}" target="_blank" rel="noopener">In neuem Tab öffnen</a>` : ''}
      <button class="ghost" data-close>Schließen</button>
    </div>`, (el) => el.classList.add('wide'));
  if (url) setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

async function editDocDialog(id) {
  const d = await DB.get('docs', id);
  if (!d) return;
  const res = await modal(`
    <div class="modal-head"><h2>Unterlage bearbeiten</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
    <form class="form">
      <label>Titel <input name="title" value="${esc(d.title)}" required></label>
      <label>Art <select name="type">${DOC_TYPES.map((t) => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Stand / Datum <input type="date" name="date" value="${esc(d.date)}"></label>
      <label>Notizen <textarea name="notes" rows="4">${esc(d.notes)}</textarea></label>
      <label class="check"><input type="checkbox" name="archived" ${d.archived ? 'checked' : ''}> veraltet</label>
      <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
    </form>`, (el, done) => {
    $('form', el).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      done({ title: f.title.value.trim() || d.title, type: f.type.value, date: f.date.value, notes: f.notes.value.trim(), archived: f.archived.checked });
    };
  });
  if (!res) return;
  Object.assign(d, res);
  await DB.put('docs', d);
  render();
}

/* ---------------- Rider-Abfrage beim Hinzufügen einer Band ---------------- */
/**
 * Fragt für jede vorhandene, nicht veraltete Unterlage der Band, ob sie noch
 * aktuell ist, und hängt die bestätigten direkt an das Konzert.
 */
async function riderCheck(bandId, concertId, { manual = false } = {}) {
  const band = await DB.get('bands', bandId);
  let concert = await DB.get('concerts', concertId);
  const entry = concert?.lineup.find((e) => e.bandId === bandId);
  if (!band || !entry) return;
  const docs = (await Data.docsOfBand(bandId))
    .filter((d) => !d.archived && !entry.docIds.includes(d.id))
    .sort((a, b) => DOC_TYPES.indexOf(a.type) - DOC_TYPES.indexOf(b.type) || (b.date || '').localeCompare(a.date || ''));

  if (!docs.length) {
    if (!manual) return;
    const r = await modal(`
      <h2>${esc(band.name)}</h2>
      <p>${entry.docIds.length ? 'Alle aktuellen Unterlagen sind bereits zugeordnet.' : 'Für diese Band ist noch nichts abgelegt.'}</p>
      <div class="actions"><button class="ghost" data-close>Schließen</button><button class="primary" data-up>Neue Unterlagen ablegen</button></div>`,
    (el, done) => ($('[data-up]', el).onclick = () => done(true)));
    if (r) await Smart.ask('', { bandId, concertId });
    return;
  }

  const res = await modal(`
    <div class="modal-head"><div><span class="badge accent">Rider gefunden</span>
      <h2>${esc(band.name)}</h2></div><button class="icon" data-close aria-label="Schließen">✕</button></div>
    <p>Für <b>${esc(band.name)}</b> ${docs.length === 1 ? 'ist bereits eine Unterlage' : `sind bereits ${docs.length} Unterlagen`} abgelegt.
       <b>Ist das noch aktuell?</b> Aktuelle Unterlagen werden direkt zu <i>${esc(concert.title)}</i> hinzugefügt.</p>
    <div class="check-list">
      ${docs.map((d) => `
      <div class="check-row" data-id="${d.id}">
        <div class="check-info">
          <div>${typeBadge(d.type)} <b>${esc(d.title)}</b> ${docBadges(d)}</div>
          <div class="muted small">${docMeta(d)}</div>
          ${isOld(d) ? `<div class="warn-text small">Seit ${Math.floor(ageDays(d.confirmedAt || d.date) / 30)} Monaten nicht bestätigt – lieber bei der Band nachfragen.</div>` : ''}
          <button type="button" class="link small" data-preview="${d.id}">ansehen</button>
        </div>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="s_${d.id}" value="add" checked><span>✓ Aktuell</span></label>
          <label><input type="radio" name="s_${d.id}" value="skip"><span>Nicht nötig</span></label>
          <label><input type="radio" name="s_${d.id}" value="old"><span>Veraltet</span></label>
        </div>
      </div>`).join('')}
    </div>
    <div class="actions">
      <button class="ghost" data-close>Später</button>
      <button class="ghost" data-allold>Alles veraltet</button>
      <button class="primary" data-ok>Übernehmen</button>
    </div>`, (el, done) => {
    $$('[data-preview]', el).forEach((b) => (b.onclick = () => previewDoc(b.dataset.preview)));
    const collect = () => Object.fromEntries(docs.map((d) => [d.id, $(`input[name="s_${d.id}"]:checked`, el).value]));
    $('[data-ok]', el).onclick = () => done(collect());
    $('[data-allold]', el).onclick = () => done(Object.fromEntries(docs.map((d) => [d.id, 'old'])));
  });
  if (!res) return;

  concert = await DB.get('concerts', concertId);
  const e = concert.lineup.find((x) => x.bandId === bandId);
  const oldTypes = new Set();
  let added = 0;
  for (const d of docs) {
    if (res[d.id] === 'add') {
      if (!e.docIds.includes(d.id)) e.docIds.push(d.id);
      d.confirmedAt = nowIso();
      await DB.put('docs', d);
      added++;
    } else if (res[d.id] === 'old') {
      d.archived = true;
      await DB.put('docs', d);
      oldTypes.add(d.type);
    }
  }
  await DB.put('concerts', concert);
  if (added) toast(`${added} Unterlage${added > 1 ? 'n' : ''} hinzugefügt`);
  if (oldTypes.size) {
    await Smart.ask(`Veraltet markiert: <b>${[...oldTypes].map(esc).join(', ')}</b>. Zieh hier gleich die neue Version rein (oder später über das Konzert).`, { bandId, concertId });
  }
}

/* ---------------- Konzert anlegen / bearbeiten ---------------- */
async function concertDialog(concert = null) {
  const bands = (await Data.bands()).sort(byName);
  const isNew = !concert;
  const chosen = [];
  const res = await modal(`
    <div class="modal-head"><h2>${isNew ? 'Neues Konzert' : 'Konzert bearbeiten'}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
    <form class="form" novalidate>
      <label>Name / Veranstaltung <input name="title" required value="${esc(concert?.title)}" placeholder="z. B. Sommerfest Open Air" autofocus></label>
      <div class="row2">
        <label>Datum <input type="date" name="date" value="${esc(concert?.date || today())}"></label>
        <label>Beginn <input type="time" name="time" value="${esc(concert?.time || '')}"></label>
      </div>
      <label>Ort / Venue <input name="venue" value="${esc(concert?.venue)}" placeholder="Club, Stadt"></label>
      ${isNew ? `
      <label>Bands
        <div class="inline">
          <input name="band" list="dl-cbands" autocomplete="off" placeholder="Bandname eingeben">
          <button type="button" class="ghost" data-addband>+</button>
        </div>
        <datalist id="dl-cbands">${bands.map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      </label>
      <div class="chips"></div>` : ''}
      <label>Notizen <textarea name="notes" rows="3" placeholder="Pult, PA, Ansprechpartner, Zeiten …">${esc(concert?.notes)}</textarea></label>
      <p class="error" hidden></p>
      <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">${isNew ? 'Anlegen' : 'Speichern'}</button></div>
    </form>`, (el, done) => {
    const form = $('form', el);
    if (isNew) {
      const known = new Map(bands.map((b) => [norm(b.name), b]));
      const chips = $('.chips', el);
      const drawChips = () => {
        chips.innerHTML = chosen.map((n, i) => {
          const k = known.get(norm(n));
          return `<span class="chip">${esc(n)}${k ? ' <span class="badge accent" title="Band ist schon in der Ablage">bekannt</span>' : ' <span class="badge">neu</span>'}<button type="button" data-rm="${i}" aria-label="entfernen">✕</button></span>`;
        }).join('');
        $$('[data-rm]', chips).forEach((b) => (b.onclick = () => { chosen.splice(+b.dataset.rm, 1); drawChips(); }));
      };
      const add = () => {
        const v = form.band.value.trim();
        if (v && !chosen.some((c) => norm(c) === norm(v))) {
          const k = known.get(norm(v));
          chosen.push(k ? k.name : v);
          drawChips();
        }
        form.band.value = '';
        form.band.focus();
      };
      $('[data-addband]', el).onclick = add;
      form.band.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      form.band.addEventListener('change', () => { if (known.has(norm(form.band.value))) add(); });
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      if (isNew && form.band.value.trim()) { const v = form.band.value.trim(); if (!chosen.some((c) => norm(c) === norm(v))) chosen.push(v); }
      const title = form.title.value.trim() || (chosen.length ? chosen.join(' / ') : '');
      if (!title) { const er = $('.error', el); er.textContent = 'Bitte einen Namen oder mindestens eine Band angeben.'; er.hidden = false; return; }
      done({ title, date: form.date.value, time: form.time.value, venue: form.venue.value.trim(), notes: form.notes.value.trim() });
    };
  });
  if (!res) return;

  if (!isNew) {
    Object.assign(concert, res);
    await DB.put('concerts', concert);
    render();
    return;
  }

  const c = { id: uid(), ...res, lineup: [], createdAt: nowIso() };
  for (const name of chosen) {
    const { band } = await Data.findOrCreateBand(name);
    if (!c.lineup.some((e) => e.bandId === band.id)) c.lineup.push({ bandId: band.id, time: '', docIds: [], unplaced: true });
  }
  await DB.put('concerts', c);
  location.hash = '#/concert/' + c.id;
  await render();
  for (const e of c.lineup) await riderCheck(e.bandId, c.id);
  render();
}

async function addBandToConcert(concertId, name) {
  if (!name.trim()) return;
  const { band, created } = await Data.findOrCreateBand(name);
  const c = await DB.get('concerts', concertId);
  if (c.lineup.some((e) => e.bandId === band.id)) { toast(`${band.name} ist schon im Line-up`); return; }
  c.lineup.push({ bandId: band.id, time: '', docIds: [], unplaced: true });
  await DB.put('concerts', c);
  await render();
  if (!created) await riderCheck(band.id, concertId);
  render();
}

async function bandDialog(band = null) {
  const res = await modal(`
    <div class="modal-head"><h2>${band ? 'Band bearbeiten' : 'Neue Band'}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
    <form class="form">
      <label>Name <input name="name" required value="${esc(band?.name)}" autofocus></label>
      <label>Genre / Besetzung <input name="genre" value="${esc(band?.genre)}" placeholder="z. B. Indie-Rock, 5-köpfig"></label>
      <label>Kontakt <textarea name="contact" rows="2" placeholder="Tech-Kontakt, Telefon, Mail">${esc(band?.contact)}</textarea></label>
      <label>Notizen <textarea name="notes" rows="3" placeholder="Eigenheiten, eigenes Equipment, Erfahrungen …">${esc(band?.notes)}</textarea></label>
      <p class="error" hidden></p>
      <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
    </form>`, (el, done) => {
    $('form', el).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.name.value.trim();
      const dup = name && (await Data.findBandByName(name));
      if (!name || (dup && dup.id !== band?.id)) {
        const er = $('.error', el);
        er.textContent = name ? 'Diese Band gibt es schon.' : 'Bitte einen Namen angeben.';
        er.hidden = false;
        return;
      }
      done({ name, genre: f.genre.value.trim(), contact: f.contact.value.trim(), notes: f.notes.value.trim() });
    };
  });
  if (!res) return null;
  const b = band ? Object.assign(band, res) : { id: uid(), createdAt: nowIso(), ...res };
  await DB.put('bands', b);
  return b;
}

/* ======================================================================
   Ansichten
   ====================================================================== */
const app = () => $('#app');

function setTab(name) {
  $$('nav.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}

function docRow(d, { concertId = null, bandName = null } = {}) {
  return `
  <li class="doc ${d.archived ? 'archived' : ''}">
    <button class="doc-main" data-preview="${d.id}">
      <span class="doc-title">${typeBadge(d.type)} ${esc(d.title)} ${docBadges(d)}</span>
      <span class="muted small">${bandName ? esc(bandName) + ' · ' : ''}${docMeta(d)}</span>
      ${d.notes ? `<span class="small doc-notes">${esc(d.notes)}</span>` : ''}
    </button>
    <div class="doc-actions">
      ${concertId ? `<button class="icon" title="Aus Konzert entfernen" data-detach="${d.id}">✕</button>` : `
        ${!d.archived ? `<button class="icon" title="Als aktuell bestätigen" data-confirm="${d.id}">✓</button>` : ''}
        <button class="icon" title="Bearbeiten" data-edit="${d.id}">✎</button>
        <button class="icon" title="Löschen" data-deldoc="${d.id}">🗑</button>`}
    </div>
  </li>`;
}

function bindDocActions(root) {
  $$('[data-preview]', root).forEach((b) => (b.onclick = () => previewDoc(b.dataset.preview)));
  $$('[data-edit]', root).forEach((b) => (b.onclick = () => editDocDialog(b.dataset.edit)));
  $$('[data-confirm]', root).forEach((b) => (b.onclick = async () => {
    const d = await DB.get('docs', b.dataset.confirm);
    d.confirmedAt = nowIso();
    await DB.put('docs', d);
    toast('Als aktuell bestätigt');
    render();
  }));
  $$('[data-deldoc]', root).forEach((b) => (b.onclick = async () => {
    if (await confirmDialog('Diese Unterlage endgültig löschen? Sie wird auch aus allen Konzerten entfernt.', 'Löschen', true)) {
      await Data.deleteDoc(b.dataset.deldoc);
      render();
    }
  }));
}

/* ---------- Konzerte ---------- */
// Running Order: eingereihte Bands in ihrer Reihenfolge, danach die ohne festgelegte Reihenfolge.
// Eine einzelne Band gilt immer als eingereiht.
const isPlaced = (c, e) => !e.unplaced || c.lineup.length === 1;
const orderedLineup = (c) => [...c.lineup.filter((e) => isPlaced(c, e)), ...c.lineup.filter((e) => !isPlaced(c, e))];

// Relative Angabe wie „Heute“, „Morgen“, „in 5 Tagen“
function relDay(iso) {
  if (!iso) return '';
  const d = Math.round((toDate(iso) - toDate(today())) / 86400000);
  if (d === 0) return 'Heute';
  if (d === 1) return 'Morgen';
  if (d === -1) return 'Gestern';
  if (d > 1 && d < 14) return `in ${d} Tagen`;
  if (d >= 14 && d < 70) return `in ${Math.round(d / 7)} Wochen`;
  return '';
}
const concertKey = (c) => (c.date || '9999-99-99') + ' ' + (c.time || '99:99');

async function viewConcerts() {
  setTab('concerts');
  const [concerts, bands, docs] = await Promise.all([Data.concerts(), Data.bands(), Data.docs()]);
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const t = today();
  // Festivals erscheinen als eine Karte; ihre Tage nicht einzeln
  const top = concerts.filter((c) => !c.festivalId && !Festival.isFestival(c));
  for (const f of concerts.filter(Festival.isFestival)) {
    const ds = Festival.daysOf(f, concerts);
    const next = ds.find((d) => d.date && d.date >= t);
    top.push({ ...f, _days: ds, date: (next || ds[ds.length - 1])?.date || '', time: next?.time || '' });
  }
  const upcoming = top.filter((c) => c.date && c.date >= t).sort((a, b) => concertKey(a).localeCompare(concertKey(b)));
  const undated = top.filter((c) => !c.date);
  const past = top.filter((c) => c.date && c.date < t).sort((a, b) => concertKey(b).localeCompare(concertKey(a)));

  const card = (c, i, isPast) => {
    if (c._days) return Festival.card(c, c._days, bandMap, docMap, isPast);
    const missing = c.lineup.filter((e) => !e.docIds.some((id) => docMap.has(id))).length;
    const outdated = c.lineup.some((e) => e.docIds.some((id) => docMap.get(id)?.archived));
    const rel = relDay(c.date);
    const next = !isPast && i === 0 && c.date;
    return `
    <a class="card concert-card ${next ? 'next' : ''} ${isPast ? 'past' : ''}" href="#/concert/${c.id}">
      <div class="date-box">${c.date ? `<span>${fmtWeekday(c.date)}</span><b>${toDate(c.date).getDate()}</b><span>${toDate(c.date).toLocaleDateString('de-DE', { month: 'short' })}</span>` : '<b>?</b>'}</div>
      <div class="grow">
        <div class="card-top">${next ? '<span class="badge accent">Als Nächstes</span>' : ''}${rel && !isPast ? `<span class="badge ${rel === 'Heute' ? 'accent' : ''}">${rel}</span>` : ''}</div>
        <div class="card-title">${esc(c.title)}</div>
        <div class="muted small">${[c.time && c.time + ' Uhr', c.venue && esc(c.venue), !isPast && Schedule.summary(c), c.date && toDate(c.date).getFullYear() !== new Date().getFullYear() && toDate(c.date).getFullYear()].filter(Boolean).join(' · ')}</div>
        <div class="band-chips">${c.lineup.map((e) => {
          const ok = e.docIds.some((id) => docMap.has(id));
          return `<span class="bchip ${ok ? 'ok' : 'missing'}" title="${ok ? 'Rider vorhanden' : 'noch kein Rider'}">${esc(bandMap.get(e.bandId)?.name || '?')}</span>`;
        }).join('') || '<span class="muted small">noch keine Bands</span>'}</div>
        ${!isPast && (missing || outdated) ? `<div class="badges">${missing ? `<span class="badge warn">${missing} ohne Rider</span>` : ''}${outdated ? '<span class="badge warn">veraltete Unterlagen</span>' : ''}</div>` : ''}
      </div>
    </a>`;
  };

  app().innerHTML = `
    <div class="page-head"><h1>Konzerte</h1><div class="head-actions"><button class="ghost" data-newfest>🎪 + Festival</button><button class="primary" data-new>+ Neues Konzert</button></div></div>
    ${!concerts.length ? `
      <div class="empty">
        <div class="empty-icon">🎤</div>
        <p><b>Noch keine Konzerte angelegt.</b></p>
        <p class="muted">Lege ein Konzert an und trag die Bands ein – wenn es für eine Band schon einen Rider gibt, wirst du gefragt, ob er noch aktuell ist, und er wird direkt zugeordnet.</p>
      </div>` : ''}
    ${concerts.length && !upcoming.length ? '<p class="muted">Keine anstehenden Konzerte.</p>' : ''}
    ${upcoming.length ? `<div class="list">${upcoming.map((c, i) => card(c, i, false)).join('')}</div>` : ''}
    ${undated.length ? `<h3 class="section">Ohne Datum</h3><div class="list">${undated.map((c, i) => card(c, 1, false)).join('')}</div>` : ''}
    ${past.length ? `<details class="section past-box" ${sessionStorage.getItem('pastOpen') ? 'open' : ''}><summary><h3>Vergangene Konzerte (${past.length})</h3></summary>
      <p class="muted small">Vergangene Konzerte bleiben mit den damals gültigen Ridern und Patchlisten erhalten.</p>
      <div class="list">${past.map((c, i) => card(c, i, true)).join('')}</div></details>` : ''}`;
  $('[data-new]').onclick = () => concertDialog();
  $('[data-newfest]').onclick = () => Festival.createDialog();
  const pb = $('.past-box');
  if (pb) pb.ontoggle = () => (pb.open ? sessionStorage.setItem('pastOpen', '1') : sessionStorage.removeItem('pastOpen'));
}

// Material-Bedarf eines Konzerts: was braucht die größte Band höchstens? (Bands spielen nacheinander)
function materialHtml(c, bandMap, docs) {
  const per = c.lineup.map((e) => {
    const b = bandMap.get(e.bandId);
    return b ? { b, rows: Patch.bandInputs(b, docs.filter((d) => d.bandId === b.id)).rows } : null;
  }).filter((x) => x && x.rows.length);
  if (!per.length) return '';
  const items = new Map();
  const bump = (key, label, n, band, order) => {
    const it = items.get(key) || { label, max: 0, by: [], order };
    it.max = Math.max(it.max, n);
    it.by.push(`${band}: ${n}`);
    items.set(key, it);
  };
  const DI = /\bdi\b|d\.i|di ?box|j ?48|bss|ar ?133|radial|klark|palmer|line/i;
  for (const { b, rows } of per) {
    const cnt = new Map();
    const inc = (k, label, order) => cnt.set(k, { label, order, n: (cnt.get(k)?.n || 0) + 1 });
    for (const r of rows) {
      if (r.mic) {
        if (DI.test(r.mic)) inc('di', 'DI-Boxen', 2);
        else {
          const m = r.mic.replace(/\b(shure|sennheiser|akg|neumann|audix|beyer\w*|electro-?voice|rode|audio-?technica|funk|wireless|eigene?s?|own|mic|mikro\w*)\b/gi, '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
          if (m) inc('mic:' + norm(m), m, 3);
          if (/funk|wireless|ulx|qlx|slx|axient|ew ?\d/i.test(r.mic)) inc('wl', 'Funkstrecken', 4);
        }
      }
      if (r.stand) {
        const st = /gro|tall|big|lang|high/i.test(r.stand) ? 'Stativ groß' : /klein|short|small|kurz|low|mini/i.test(r.stand) ? 'Stativ klein' : /clamp|clip|klemm/i.test(r.stand) ? 'Klemmen / Clips' : 'Stative (ohne Angabe)';
        inc('st:' + st, st, 5);
      }
      if (r.phantom) inc('ph', '+48V-Kanäle', 6);
    }
    bump('in', 'Inputs', rows.length, b.name, 1);
    for (const [k, v] of cnt) bump(k, v.label, v.n, b.name, v.order);
  }
  const list = [...items.values()].sort((x, y) => x.order - y.order || y.max - x.max || x.label.localeCompare(y.label));
  return `
    <details class="card material">
      <summary><b>🎤 Material-Bedarf</b> <span class="muted small">– höchster Bedarf einer Band (${per.length} von ${c.lineup.length} Bands mit Inputliste)</span></summary>
      <div class="table-wrap"><table class="ptable">
        <thead><tr><th>Material</th><th>max.</th><th>pro Band</th></tr></thead>
        <tbody>${list.map((it) => `<tr><td><b>${esc(it.label)}</b></td><td class="ch">${it.max}</td><td class="small muted">${it.by.map(esc).join(' · ')}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
}

// Band in die Running Order setzen: ans Ende – oder, wenn sie eine Spielzeit hat, passend nach Zeit
function placeBand(c, e, byTime = false) {
  e.unplaced = false;
  const rest = c.lineup.filter((x) => x !== e);
  const placedRest = rest.filter((x) => !x.unplaced);
  let at = placedRest.length ? rest.indexOf(placedRest[placedRest.length - 1]) + 1 : 0;
  if (byTime && e.time) {
    const later = placedRest.find((x) => x.time && concertKey({ date: '0', time: x.time }) > concertKey({ date: '0', time: e.time }));
    if (later) at = rest.indexOf(later);
  }
  rest.splice(at, 0, e);
  c.lineup = rest;
}

async function viewConcert(id, sub) {
  setTab('concerts');
  let c = await DB.get('concerts', id);
  if (!c) { app().innerHTML = '<p>Konzert nicht gefunden. <a href="#/concerts">Zurück</a></p>'; return; }
  // Festivaltag direkt aufgerufen → innerhalb des Festivals anzeigen
  if (c.festivalId) { location.replace(`#/concert/${c.festivalId}/${c.id}`); return; }
  let fest = null;
  if (Festival.isFestival(c)) {
    fest = await Festival.prepare(c, sub);
    if (!fest.day) { await Festival.overview(fest); return; }
    c = fest.day;
  }
  const [bands, docs, profiles] = await Promise.all([Data.bands(), Data.docs(), DB.all('profiles')]);
  profiles.sort(byName);
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const docMap = new Map(docs.map((d) => [d.id, d]));

  const placed = c.lineup.filter((e) => isPlaced(c, e));
  const open = c.lineup.filter((e) => !isPlaced(c, e));
  const entryHtml = (e) => {
    const i = c.lineup.indexOf(e);
    const pos = placed.indexOf(e);
    const b = bandMap.get(e.bandId);
    const eDocs = e.docIds.map((x) => docMap.get(x)).filter(Boolean);
    const newer = docs.filter((d) => d.bandId === e.bandId && !d.archived && !e.docIds.includes(d.id));
    const hasOutdated = eDocs.some((d) => d.archived);
    return `
    <div class="card lineup" data-band="${e.bandId}">
      <div class="lineup-head">
        ${pos >= 0 && c.lineup.length > 1 ? `<span class="pos" title="Position in der Running Order">${pos + 1}</span>` : ''}
        <input type="time" class="time" value="${esc(e.time)}" data-time="${i}" aria-label="Spielzeit">
        <a class="card-title grow" href="#/band/${e.bandId}">${esc(b?.name || '?')}</a>
        ${pos >= 0 && c.lineup.length > 1 ? `
          <button class="icon" title="nach oben" data-up="${i}" ${pos === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon" title="nach unten" data-down="${i}" ${pos === placed.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon" title="Reihenfolge wieder offen lassen" data-unplace="${i}">↧</button>`
        : pos < 0 ? `<button class="ghost small-btn" data-place="${i}" title="Ans Ende der Running Order setzen">↥ Einreihen</button>` : ''}
        <button class="icon" title="Band aus ${fest ? 'diesem Tag' : 'dem Konzert'} entfernen" data-rmband="${i}">✕</button>
      </div>
      ${b?.genre ? `<div class="muted small">${esc(b.genre)}</div>` : ''}
      ${eDocs.length ? `<ul class="docs">${eDocs.map((d) => docRow(d, { concertId: c.id })).join('')}</ul>`
        : '<p class="warn-text small">Noch keine Unterlagen für dieses Konzert.</p>'}
      ${hasOutdated ? '<p class="warn-text small">Mindestens eine Unterlage ist als veraltet markiert – neue Version hochladen?</p>' : ''}
      <div class="lineup-actions">
        ${newer.length ? `<button class="ghost small-btn" data-check="${e.bandId}">📂 Aus Ablage (${newer.length})</button>` : ''}
        <button class="ghost small-btn" data-upload="${e.bandId}">⬆︎ Rider ablegen</button>
        <button class="ghost small-btn" data-note="${e.bandId}">📝 Notiz</button>
        <a class="button ghost small-btn" href="#/band/${e.bandId}/patch/${c.profileId || ''}/${c.id}">🎛 Patch</a>
        ${fest ? `<select class="move-sel" data-move="${e.bandId}" aria-label="Band verschieben"><option value="">↔ Verschieben …</option>${Festival.moveOptions(fest, c.id)}</select>` : ''}
      </div>
    </div>`;
  };

  const rel = relDay(c.date);
  const isPast = c.date && c.date < today();
  const allPrint = PatchUI.concertSheets(c, profiles, bands, docs);
  app().innerHTML = `
    ${fest ? Festival.head(fest) + Festival.dayHead(fest) : `    <a class="back" href="#/concerts">‹ Konzerte</a>
    <div class="page-head">
      <div><h1>${esc(c.title)}</h1>
        <div class="muted">${[c.date && fmtWeekday(c.date) + ', ' + fmtDate(c.date), c.time && c.time + ' Uhr', c.venue && esc(c.venue)].filter(Boolean).join(' · ')}
          ${rel ? `<span class="badge ${rel === 'Heute' ? 'accent' : ''}">${rel}</span>` : ''}${isPast ? '<span class="badge">vergangen</span>' : ''}</div></div>
      <div class="head-actions"><button class="ghost" data-editc>Bearbeiten</button><button class="ghost danger-text" data-delc>Löschen</button></div>
    </div>`}
    ${c.notes ? `<div class="notes">${esc(c.notes)}</div>` : ''}
    <div class="concert-tools card">
      ${profiles.length ? `<label class="lbl">🎛 Stagebox für ${fest ? 'diesen Tag' : 'dieses Konzert'}
        <select data-cprofile><option value="">– wählen –</option>${profiles.map((p) => `<option value="${p.id}" ${p.id === c.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`
        : '<p class="small muted">Lege unter „Stagebox“ ein Profil an, um Patchlisten zu erzeugen.</p>'}
      ${(profiles.length && c.lineup.length) || (c.schedule || []).length ? `<div class="printall-wrap"><button class="primary" data-printall ${allPrint.html ? '' : 'disabled'}>🖨 ${fest ? 'Diesen Tag drucken' : 'Alle Patchlisten drucken'}</button>
        <span class="small muted">${allPrint.count ? `${allPrint.count} Patchliste${allPrint.count > 1 ? 'n' : ''} · Stagebox „${esc(allPrint.profile.name)}“${c.profileId ? '' : ' (Vorauswahl)'}${(c.schedule || []).length ? ' · mit Tagesablauf' : ''}` : (c.schedule || []).length ? 'Tagesablauf (noch keine Inputlisten)' : 'Keine Band hat eine Inputliste'}${allPrint.missing.length ? `<br><span class="warn-text">ohne Inputliste: ${allPrint.missing.map(esc).join(', ')}</span>` : ''}</span></div>` : ''}
    </div>
    ${Schedule.html(c, bandMap)}
    ${materialHtml(c, bandMap, docs)}
    <h3 class="section">${c.lineup.length > 1 ? 'Running Order' : 'Line-up'}</h3>
    <div class="list">${placed.map(entryHtml).join('') || (open.length ? '<p class="muted small">Noch keine Reihenfolge festgelegt – reihe die Bands unten ein, sobald sie feststeht (oder trag eine Spielzeit ein).</p>' : '<p class="muted">Noch keine Bands.</p>')}</div>
    ${open.length ? `<h3 class="section">Reihenfolge offen <span class="badge">${open.length}</span></h3>
    <div class="list open-list">${open.map(entryHtml).join('')}</div>` : ''}
    <form class="add-band card" autocomplete="off">
      <input name="band" list="dl-addband" placeholder="Band hinzufügen …">
      <datalist id="dl-addband">${bands.filter((b) => !c.lineup.some((e) => e.bandId === b.id)).sort(byName).map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      <button class="primary">+ Band</button>
    </form>`;

  const save = async () => { await DB.put('concerts', c); render(); };
  const cp = $('[data-cprofile]');
  if (cp) cp.onchange = () => { c.profileId = cp.value || null; save(); };
  const pa = $('[data-printall]');
  if (pa) pa.onclick = () => printPages(allPrint.html);
  Schedule.bind(c, bandMap, docs);
  if (fest) Festival.bindHead(fest);
  $('[data-editc]').onclick = () => (fest ? Festival.dayDialog(fest.f, c) : concertDialog(c));
  const delc = $('[data-delc]');
  if (delc) delc.onclick = async () => {
    if (await confirmDialog(`Konzert „${esc(c.title)}“ löschen? Die Rider bleiben bei den Bands gespeichert.`, 'Löschen', true)) {
      await DB.del('concerts', c.id);
      location.hash = '#/concerts';
    }
  };
  $$('[data-time]').forEach((inp) => (inp.onchange = () => {
    const e = c.lineup[+inp.dataset.time];
    e.time = inp.value;
    if (!isPlaced(c, e) && inp.value) placeBand(c, e, true);
    const show = (c.schedule || []).find((x) => x.type === 'show' && x.bandId === e.bandId);
    if (show && inp.value) show.time = inp.value;
    save();
  }));
  // Nach oben/unten nur innerhalb der Running Order
  const swap = (i, dir) => {
    const idx = c.lineup.map((e, k) => (isPlaced(c, e) ? k : -1)).filter((k) => k >= 0);
    const p = idx.indexOf(i), j = idx[p + dir];
    if (j === undefined) return;
    [c.lineup[i], c.lineup[j]] = [c.lineup[j], c.lineup[i]];
    save();
  };
  $$('[data-up]').forEach((b) => (b.onclick = () => swap(+b.dataset.up, -1)));
  $$('[data-down]').forEach((b) => (b.onclick = () => swap(+b.dataset.down, 1)));
  $$('[data-place]').forEach((b) => (b.onclick = () => { placeBand(c, c.lineup[+b.dataset.place]); save(); }));
  $$('[data-unplace]').forEach((b) => (b.onclick = () => {
    const e = c.lineup[+b.dataset.unplace];
    e.unplaced = true;
    c.lineup = [...c.lineup.filter((x) => x !== e), e];
    save();
  }));
  $$('[data-move]').forEach((s) => (s.onchange = () => s.value && Festival.moveBand(c.id, s.dataset.move, s.value)));
  $$('[data-rmband]').forEach((b) => (b.onclick = async () => {
    const e = c.lineup[+b.dataset.rmband];
    if (await confirmDialog(`${esc(bandMap.get(e.bandId)?.name)} aus diesem Konzert entfernen? (Band und Rider bleiben in der Ablage.)`, 'Entfernen', true)) {
      c.lineup.splice(+b.dataset.rmband, 1);
      save();
    }
  }));
  $$('[data-detach]').forEach((b) => (b.onclick = () => {
    const bandId = b.closest('[data-band]').dataset.band;
    const e = c.lineup.find((x) => x.bandId === bandId);
    e.docIds = e.docIds.filter((x) => x !== b.dataset.detach);
    save();
  }));
  $$('[data-check]').forEach((b) => (b.onclick = async () => { await riderCheck(b.dataset.check, c.id, { manual: true }); render(); }));
  $$('[data-upload]').forEach((b) => (b.onclick = async () => { const f = await Smart.pickFiles(); if (f.length) await Smart.run(f, { bandId: b.dataset.upload, concertId: c.id }); }));
  $$('[data-note]').forEach((b) => (b.onclick = () => Smart.noteDialog({ bandId: b.dataset.note, concertId: c.id })));
  bindDocActions(app());
  $('.add-band').onsubmit = (e) => { e.preventDefault(); addBandToConcert(c.id, e.target.band.value); };
}

/* ---------- Bands ---------- */
let bandFilter = '';
async function viewBands() {
  setTab('bands');
  const [bands, docs, concerts] = await Promise.all([Data.bands(), Data.docs(), Data.concerts()]);
  bands.sort(byName);
  app().innerHTML = `
    <div class="page-head"><h1>Bands</h1><button class="primary" data-newband>+ Band</button></div>
    <input class="search" type="search" placeholder="Band suchen …" value="${esc(bandFilter)}" autofocus>
    <div class="list band-list"></div>`;

  const list = $('.band-list');
  const draw = () => {
    const q = norm(bandFilter);
    const shown = bands.filter((b) => !q || norm(b.name + ' ' + b.genre).includes(q));
    list.innerHTML = shown.map((b) => {
      const bd = docs.filter((d) => d.bandId === b.id && !d.archived);
      const latest = bd.map((d) => d.date || '').sort().pop();
      const nC = concerts.filter((c) => c.lineup.some((e) => e.bandId === b.id)).length;
      const old = bd.length && bd.every(isOld);
      return `
      <a class="card band-card" href="#/band/${b.id}">
        <div class="avatar">${esc(b.name.trim()[0]?.toUpperCase() || '?')}</div>
        <div class="grow">
          <div class="card-title">${esc(b.name)}</div>
          <div class="muted small">${[b.genre && esc(b.genre), `${nC} Konzert${nC === 1 ? '' : 'e'}`].filter(Boolean).join(' · ')}</div>
          <div class="badges">${bd.length ? `<span class="badge">${bd.length} Unterlagen</span>` : '<span class="badge warn">kein Rider</span>'}
            ${latest ? `<span class="badge">Stand ${fmtDate(latest)}</span>` : ''}${old ? '<span class="badge warn">alt?</span>' : ''}</div>
        </div>
      </a>`;
    }).join('') || `<div class="empty"><p class="muted">${bands.length ? 'Keine Band gefunden.' : 'Noch keine Bands. Bands entstehen automatisch, wenn du sie in ein Konzert einträgst oder Unterlagen hochlädst.'}</p>
      ${bandFilter ? `<button class="primary" data-create>„${esc(bandFilter)}“ anlegen</button>` : ''}</div>`;
    const cr = $('[data-create]', list);
    if (cr) cr.onclick = async () => { const b = await bandDialog({ id: uid(), name: bandFilter, genre: '', contact: '', notes: '', createdAt: nowIso() }); if (b) location.hash = '#/band/' + b.id; };
  };
  draw();
  const s = $('.search');
  s.oninput = () => { bandFilter = s.value; draw(); };
  $('[data-newband]').onclick = async () => { const b = await bandDialog(); if (b) location.hash = '#/band/' + b.id; };
}

function bandConcerts(bc, bandId) {
  if (!bc.length) return '<p class="muted">Noch in keinem Konzert.</p>';
  const t = today();
  const row = (c) => `<a class="card row-card" href="#/concert/${c.id}"><span class="grow"><b>${esc(c.title)}</b><br><span class="muted small">${[c.date && fmtDate(c.date), c.time && c.time + ' Uhr', c.venue && esc(c.venue)].filter(Boolean).join(' · ')}</span></span>${relDay(c.date) ? `<span class="badge">${relDay(c.date)}</span>` : ''}</a>`;
  const up = bc.filter((c) => !c.date || c.date >= t).sort((a, b) => concertKey(a).localeCompare(concertKey(b)));
  const past = bc.filter((c) => c.date && c.date < t).sort((a, b) => concertKey(b).localeCompare(concertKey(a)));
  return `${up.length ? `<div class="list">${up.map(row).join('')}</div>` : '<p class="muted small">Kein anstehendes Konzert.</p>'}
    ${past.length ? `<details class="section"><summary><h3>Vergangen (${past.length})</h3></summary><div class="list">${past.map(row).join('')}</div></details>` : ''}`;
}

async function viewBand(id, tab = '', arg = '', arg2 = '') {
  setTab('bands');
  const b = await DB.get('bands', id);
  if (!b) { app().innerHTML = '<p>Band nicht gefunden. <a href="#/bands">Zurück</a></p>'; return; }
  const [docs, concerts] = await Promise.all([Data.docsOfBand(id), Data.concerts()]);
  const active = docs.filter((d) => !d.archived);
  const archived = docs.filter((d) => d.archived).sort((a, x) => (x.date || '').localeCompare(a.date || ''));
  const groups = DOC_TYPES.map((t) => [t, active.filter((d) => d.type === t).sort((a, x) => (x.date || '').localeCompare(a.date || ''))]).filter(([, l]) => l.length);
  const bc = concerts.filter((c) => c.lineup.some((e) => e.bandId === id)).sort((a, x) => (x.date || '').localeCompare(a.date || ''));

  const t = ['patch', 'docs'].includes(tab) ? tab : 'info';
  const tabs = `<nav class="subtabs no-print">
      <a href="#/band/${id}" class="${t === 'info' ? 'active' : ''}">Überblick</a>
      <a href="#/band/${id}/patch" class="${t === 'patch' ? 'active' : ''}">🎛 Patch</a>
      <a href="#/band/${id}/docs" class="${t === 'docs' ? 'active' : ''}">Unterlagen (${active.length})</a></nav>`;
  const head = `
    <a class="back no-print" href="#/bands">‹ Bands</a>
    <div class="page-head no-print">
      <div><h1>${esc(b.name)}</h1>${b.genre ? `<div class="muted">${esc(b.genre)}</div>` : ''}</div>
      <div class="head-actions"><button class="ghost" data-editb>Bearbeiten</button><button class="ghost danger-text" data-delb>Löschen</button></div>
    </div>`;
  const bindHead = () => {
    $('[data-editb]').onclick = async () => { if (await bandDialog(b)) render(); };
    $('[data-delb]').onclick = async () => {
      if (await confirmDialog(`Band „${esc(b.name)}“ mit allen ${docs.length} Unterlagen löschen? Sie wird auch aus allen Konzerten entfernt.`, 'Löschen', true)) {
        await Data.deleteBand(id);
        location.hash = '#/bands';
      }
    };
  };
  if (t === 'info') {
    app().innerHTML = head + `
      ${b.contact ? `<div class="notes"><b>Kontakt:</b> ${esc(b.contact)}</div>` : ''}
      ${b.notes ? `<div class="notes">${esc(b.notes)}</div>` : ''}` + tabs + PatchUI.overview(b, docs) + `
      <h3 class="section">Konzerte</h3>
      ${bandConcerts(bc, id)}`;
    bindHead();
    PatchUI.bindOverview(b, docs);
    return;
  }
  if (t === 'patch') {
    app().innerHTML = head + tabs + (await PatchUI.patchTab(b, docs, arg, arg2));
    bindHead();
    PatchUI.bindPatch(b, docs);
    return;
  }
  app().innerHTML = head + tabs + `
    <div class="page-head"><h3 class="section">Aktuelle Unterlagen</h3><div class="head-actions"><button class="ghost" data-note>📝 Notiz</button><button class="primary" data-upload>⬆︎ Rider ablegen</button></div></div>
    ${groups.length ? groups.map(([t, l]) => `<ul class="docs">${l.map((d) => docRow(d)).join('')}</ul>`).join('')
      : '<p class="muted">Noch keine Unterlagen. Lade Techrider, Inputliste, Stageplot o. ä. hoch.</p>'}
    ${archived.length ? `<details class="section"><summary><h3>Veraltete Versionen (${archived.length})</h3></summary><ul class="docs">${archived.map((d) => docRow(d)).join('')}</ul></details>` : ''}`;
  bindHead();
  $('[data-upload]').onclick = async () => { const f = await Smart.pickFiles(); if (f.length) await Smart.run(f, { bandId: id }); };
  $('[data-note]').onclick = () => Smart.noteDialog({ bandId: id });
  bindDocActions(app());
}

/* ---------- Suche ---------- */
let searchQuery = '';
async function viewSearch() {
  setTab('search');
  const [bands, docs, concerts] = await Promise.all([Data.bands(), Data.docs(), Data.concerts()]);
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  app().innerHTML = `
    <div class="page-head"><h1>Suche</h1></div>
    <input class="search" type="search" placeholder="Bands, Konzerte, Orte, Rider-Inhalte …" value="${esc(searchQuery)}" autofocus>
    <div class="results"></div>`;
  const out = $('.results');
  const draw = () => {
    const terms = searchQuery.split(/\s+/).map(norm).filter(Boolean);
    if (!terms.length) { out.innerHTML = '<p class="muted">Durchsucht auch den Text in den Ridern – z. B. „sm58“, „iem“ oder „flügel“.</p>'; return; }
    // Treffer, wenn jeder Begriff ein Wortanfang ist (ab 4 Zeichen auch mitten im Wort)
    const hit = (text) => {
      const words = String(text ?? '').split(/[\s\-_.,/()]+/).map(norm).filter(Boolean);
      const all = words.join('');
      return terms.every((t) => words.some((w) => w.startsWith(t)) || (t.length >= 4 && all.includes(t)));
    };
    const rb = bands.filter((b) => hit([b.name, b.genre, b.contact, b.notes].join(' '))).sort(byName);
    const rc = concerts.filter((c) => hit([c.title, c.venue, c.notes, c.date, fmtDate(c.date), ...c.lineup.map((e) => bandMap.get(e.bandId)?.name)].join(' ')))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const rd = docs.filter((d) => hit([d.title, d.type, d.notes, d.fileName, bandMap.get(d.bandId)?.name, d.text].join(' ')))
      .sort((a, b) => a.archived - b.archived || (b.date || '').localeCompare(a.date || ''));
    out.innerHTML = `
      ${rb.length ? `<h3 class="section">Bands (${rb.length})</h3><div class="list">${rb.map((b) => `<a class="card row-card" href="#/band/${b.id}"><div class="avatar">${esc(b.name[0]?.toUpperCase())}</div><span class="grow"><b>${esc(b.name)}</b>${b.genre ? `<br><span class="muted small">${esc(b.genre)}</span>` : ''}</span></a>`).join('')}</div>` : ''}
      ${rc.length ? `<h3 class="section">Konzerte (${rc.length})</h3><div class="list">${rc.map((c) => `<a class="card row-card" href="#/concert/${c.id}"><span class="grow"><b>${esc(c.title)}</b><br><span class="muted small">${[fmtDate(c.date), c.venue && esc(c.venue), c.lineup.map((e) => esc(bandMap.get(e.bandId)?.name)).join(', ')].filter(Boolean).join(' · ')}</span></span></a>`).join('')}</div>` : ''}
      ${rd.length ? `<h3 class="section">Unterlagen (${rd.length})</h3><ul class="docs">${rd.map((d) => docRow(d, { bandName: bandMap.get(d.bandId)?.name })).join('')}</ul>` : ''}
      ${!rb.length && !rc.length && !rd.length ? '<p class="muted">Nichts gefunden.</p>' : ''}`;
    bindDocActions(out);
  };
  draw();
  const s = $('.search');
  s.oninput = () => { searchQuery = s.value; draw(); };
}

/* ---------- Mehr: Backup ---------- */
const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

async function exportAll() {
  const [bands, docs, concerts, profiles] = await Promise.all([Data.bands(), Data.docs(), Data.concerts(), DB.all('profiles')]);
  const docsOut = [];
  for (const d of docs) docsOut.push({ ...d, blob: undefined, data: d.blob ? await blobToDataURL(d.blob) : null });
  const json = JSON.stringify({ app: 'rider-ablage', version: 2, exportedAt: nowIso(), bands, concerts, profiles, docs: docsOut });
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `rider-ablage-backup-${today()}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  localStorage.setItem('lastBackup', nowIso());
  render();
}

async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Datei ist kein gültiges Backup'); return; }
  if (data.app !== 'rider-ablage') { toast('Datei ist kein Rider-Ablage-Backup'); return; }
  if (!(await confirmDialog(`Backup vom ${fmtDate(data.exportedAt)} einspielen? (${data.bands.length} Bands, ${data.concerts.length} Konzerte, ${data.docs.length} Unterlagen)<br><span class="muted small">Vorhandene Einträge mit gleicher ID werden überschrieben, alles andere bleibt erhalten.</span>`, 'Einspielen'))) return;
  for (const b of data.bands) await DB.put('bands', b);
  for (const c of data.concerts) await DB.put('concerts', c);
  for (const p of data.profiles || []) await DB.put('profiles', p);
  for (const d of data.docs) {
    const { data: dataUrl, ...rest } = d;
    rest.blob = dataUrl ? await (await fetch(dataUrl)).blob() : null;
    rest.fileUploaded = false;
    await DB.put('docs', rest);
  }
  toast('Backup eingespielt');
  render();
}

function cloudStateText() {
  const last = Cloud.lastSync;
  const t = {
    ok: `✓ Synchronisiert${last ? ' · zuletzt ' + new Date(last).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''}`,
    syncing: '⟳ Synchronisiere …',
    offline: '⨯ Offline – Änderungen werden übertragen, sobald wieder Netz da ist.',
    error: `<span class="warn-text">! Fehler: ${esc(Cloud.error)}</span>`,
    loggedout: Cloud.error ? `<span class="warn-text">${esc(Cloud.error)}</span>` : 'Nicht angemeldet',
    off: 'Nicht eingerichtet',
  };
  return t[Cloud.state] || '';
}

function cloudCard() {
  if (!Cloud.configured()) {
    return `
    <div class="card">
      <h3>☁︎ Cloud-Speicher einrichten</h3>
      <p class="small">Damit Rider und Konzerte auf allen Geräten (Handy, Laptop, Tablet) gleich sind, nutzt die Ablage <b>Supabase</b> – kostenlos für diese Datenmengen. Einmalig einrichten (ca. 5 Minuten):</p>
      <ol class="small steps">
        <li>Auf <b>supabase.com</b> kostenlos registrieren und ein neues Projekt anlegen.</li>
        <li>Im Projekt <b>SQL Editor</b> öffnen, den Inhalt von <code>supabase/schema.sql</code> aus diesem Repository einfügen und <b>Run</b> drücken.</li>
        <li>Unter <b>Project Settings → API</b> die <b>Project URL</b> und den <b>anon / publishable key</b> kopieren und hier eintragen.</li>
      </ol>
      <form class="form" data-cfg>
        <label>Project URL <input name="url" placeholder="https://xxxx.supabase.co" required autocomplete="off"></label>
        <label>anon / publishable key <input name="key" placeholder="eyJhbGciOi… oder sb_publishable_…" required autocomplete="off"></label>
        <p class="error" hidden></p>
        <div class="actions left"><button class="primary">Verbinden</button></div>
      </form>
    </div>`;
  }
  if (!Cloud.loggedIn()) {
    return `
    <div class="card">
      <h3>☁︎ Anmelden</h3>
      <p class="small" id="cloud-state">${cloudStateText()}</p>
      <form class="form" data-login>
        <label>E-Mail <input type="email" name="email" required autocomplete="username"></label>
        <label>Passwort <input type="password" name="password" required minlength="6" autocomplete="current-password"></label>
        <p class="error" hidden></p>
        <div class="actions left"><button class="primary" data-mode="in">Anmelden</button><button class="ghost" data-mode="up">Neues Konto anlegen</button></div>
      </form>
      <p class="muted small">Verbunden mit ${esc(Cloud.config.url)} · <button class="link small" data-reset>Verbindung ändern</button></p>
    </div>`;
  }
  return `
    <div class="card">
      <h3>☁︎ Cloud</h3>
      <p class="small">Angemeldet als <b>${esc(Cloud.email)}</b></p>
      <p class="small" id="cloud-state">${cloudStateText()}</p>
      <div class="actions left">
        <button class="primary" data-sync>Jetzt synchronisieren</button>
        <button class="ghost" data-link>Link für weiteres Gerät</button>
        <button class="ghost" data-logout>Abmelden</button>
      </div>
      <p class="muted small">Auf einem neuen Gerät einfach den Link öffnen und mit denselben Zugangsdaten anmelden. Ohne Netz arbeitest du mit der lokalen Kopie weiter – Änderungen werden später übertragen.</p>
    </div>`;
}

function bindCloudCard() {
  const cfg = $('[data-cfg]');
  if (cfg) cfg.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.error', cfg), btn = $('button', cfg);
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Prüfe Verbindung …';
    const problem = await Cloud.configure(cfg.url.value, cfg.key.value);
    btn.disabled = false;
    btn.textContent = 'Verbinden';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    toast('Verbunden – jetzt Konto anlegen oder anmelden');
    render();
  };
  const login = $('[data-login]');
  if (login) {
    let mode = 'in';
    $$('[data-mode]', login).forEach((b) => (b.onclick = () => { mode = b.dataset.mode; }));
    login.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('.error', login);
      err.hidden = true;
      const btns = $$('button', login);
      btns.forEach((b) => (b.disabled = true));
      try {
        if (mode === 'up') {
          const r = await Cloud.signUp(login.email.value.trim(), login.password.value);
          if (r === 'confirm') { toast('Bestätigungs-Mail verschickt'); err.textContent = 'Bitte bestätige die E-Mail und melde dich dann hier an.'; err.hidden = false; return; }
        } else {
          await Cloud.signIn(login.email.value.trim(), login.password.value);
        }
        toast('Angemeldet – Daten werden synchronisiert');
        render();
      } catch (ex) {
        err.textContent = /invalid path/i.test(ex.message) ? 'Die Project URL stimmt nicht. Tippe unten auf „Verbindung ändern“ und trage nur https://xxxx.supabase.co ein.'
          : /already registered/i.test(ex.message) ? 'Für diese E-Mail gibt es schon ein Konto – bitte „Anmelden“ nutzen.'
          : /password/i.test(ex.message) && /least|short|weak/i.test(ex.message) ? 'Das Passwort ist zu kurz (mindestens 6 Zeichen).'
          : /invalid login/i.test(ex.message) ? 'E-Mail oder Passwort falsch.' : /not confirmed/i.test(ex.message) ? 'E-Mail ist noch nicht bestätigt.' : 'Fehler: ' + ex.message;
        err.hidden = false;
      } finally { btns.forEach((b) => (b.disabled = false)); }
    };
  }
  const reset = $('[data-reset]');
  if (reset) reset.onclick = () => { Cloud.resetConfig(); render(); };
  const sync = $('[data-sync]');
  if (sync) sync.onclick = () => Cloud.sync();
  const logout = $('[data-logout]');
  if (logout) logout.onclick = async () => {
    if (await confirmDialog('Abmelden? Die Daten bleiben auf diesem Gerät gespeichert.', 'Abmelden')) { await Cloud.signOut(); render(); }
  };
  const link = $('[data-link]');
  if (link) link.onclick = async () => {
    const url = Cloud.setupLink();
    try { await navigator.clipboard.writeText(url); toast('Link kopiert'); } catch { /* ignorieren */ }
    modal(`<h2>Weiteres Gerät verbinden</h2><p class="small">Öffne diesen Link auf dem anderen Gerät und melde dich mit deinen Zugangsdaten an. (Der Link enthält kein Passwort.)</p>
      <textarea readonly rows="4" class="small">${esc(url)}</textarea><div class="actions"><button class="primary" data-close>OK</button></div>`);
  };
}

async function viewMore() {
  setTab('more');
  const [bands, docs, concerts] = await Promise.all([Data.bands(), Data.docs(), Data.concerts()]);
  const size = docs.reduce((n, d) => n + (d.size || 0), 0);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const last = localStorage.getItem('lastBackup');
  app().innerHTML = `
    <div class="page-head"><h1>Cloud & Backup</h1></div>
    ${cloudCard()}
    <div class="stats">
      <div class="card stat"><b>${concerts.length}</b><span>Konzerte</span></div>
      <div class="card stat"><b>${bands.length}</b><span>Bands</span></div>
      <div class="card stat"><b>${docs.length}</b><span>Unterlagen</span></div>
      <div class="card stat"><b>${fmtSize(size) || '0 KB'}</b><span>Dateien</span></div>
    </div>
    <div class="card">
      <h3>Backup</h3>
      <p class="muted small">${Cloud.loggedIn() ? 'Zusätzlich zur Cloud kannst du eine Sicherungsdatei mit allen Ridern herunterladen.' : 'Ohne Cloud liegen alle Daten nur in diesem Browser. Mach regelmäßig ein Backup – damit kannst du die Ablage auch auf ein anderes Gerät übertragen.'}</p>
      <p class="small">${last ? 'Letztes Backup: ' + fmtDate(last) : '<span class="warn-text">Noch kein Backup erstellt.</span>'}</p>
      <div class="actions left"><button class="primary" data-export>Backup herunterladen</button>
        <label class="button ghost">Backup einspielen<input type="file" accept="application/json,.json" hidden data-import></label></div>
    </div>
    <div class="card">
      <h3>Speicher</h3>
      <p class="small">${persisted ? '✓ Dauerhafter Speicher ist aktiv – der Browser löscht die Daten nicht automatisch.' : 'Der Browser könnte die Daten bei Speichermangel löschen.'}</p>
      ${persisted ? '' : '<button class="ghost" data-persist>Dauerhaften Speicher anfordern</button>'}
      <p class="muted small">Tipp: Über „Zum Home-Bildschirm hinzufügen“ lässt sich die Ablage wie eine App nutzen – auch offline.</p>
    </div>`;
  bindCloudCard();
  $('[data-export]').onclick = exportAll;
  $('[data-import]').onchange = (e) => e.target.files[0] && importAll(e.target.files[0]);
  const p = $('[data-persist]');
  if (p) p.onclick = async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Dauerhafter Speicher aktiv' : 'Vom Browser abgelehnt – App zum Home-Bildschirm hinzufügen hilft oft'); render(); };
}

/* ---------------- Drucken ----------------
   window.print() muss direkt aus dem Antippen heraus aufgerufen werden – sonst ignoriert
   Safari auf iPhone/iPad den Druck. Deshalb wird alles vorher fertig vorbereitet. */
function printPages(html) {
  let root = $('#print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = html;
  document.body.classList.add('print-all');
  window.print();
}
function clearPrintPages() {
  document.body.classList.remove('print-all');
  const root = $('#print-root');
  if (root) root.innerHTML = '';
}
window.addEventListener('hashchange', clearPrintPages);

/* ---------------- Router ---------------- */
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const [, view, id, sub, arg, arg2] = (location.hash || '#/concerts').split('/');
  const scroll = window.scrollY;
  const sameView = render.last === location.hash;
  render.last = location.hash;
  const views = { concerts: viewConcerts, concert: () => viewConcert(id, sub), bands: viewBands, band: () => viewBand(id, sub, arg, arg2), search: viewSearch, more: viewMore,
    stagebox: () => (id ? PatchUI.viewProfile(id) : PatchUI.viewStagebox()) };
  await (views[view] || viewConcerts)();
  if (seq === renderSeq) window.scrollTo(0, sameView ? scroll : 0);
}

window.addEventListener('hashchange', render);

// Dateien irgendwo auf die Seite ziehen → automatisch erkennen und ablegen
const dropOverlay = $('#drop-overlay');
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer?.types?.includes('Files') && !document.querySelector('.modal-backdrop');
window.addEventListener('dragenter', (e) => { if (isFileDrag(e)) { dragDepth++; dropOverlay.hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.hidden = true; } });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (document.querySelector('.modal-backdrop') || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  const [, view, id] = location.hash.split('/');
  const ctx = {};
  if (view === 'band') ctx.bandId = id;
  if (view === 'concert') {
    ctx.concertId = id;
    const card = e.target.closest?.('[data-band]');
    if (card) ctx.bandId = card.dataset.band;
  }
  Smart.run(e.dataTransfer.files, ctx);
});
$('#add-rider').onclick = async () => {
  const f = await Smart.pickFiles();
  if (!f.length) return;
  const [, view, id] = location.hash.split('/');
  Smart.run(f, view === 'concert' ? { concertId: id } : view === 'band' ? { bandId: id } : {});
};

// Cloud-Status im Kopf anzeigen
const SYNC_LABEL = {
  off: ['☁︎', 'Cloud nicht eingerichtet'], loggedout: ['☁︎', 'Nicht angemeldet'], ok: ['☁︎ ✓', 'Synchronisiert'],
  syncing: ['☁︎ ⟳', 'Synchronisiere …'], offline: ['☁︎ ⨯', 'Offline – Änderungen werden später übertragen'], error: ['☁︎ !', 'Fehler beim Synchronisieren'],
};
function showSync() {
  const el = $('#sync');
  const [icon, label] = SYNC_LABEL[Cloud.state] || SYNC_LABEL.off;
  el.textContent = icon;
  el.title = label + (Cloud.error ? ': ' + Cloud.error : '');
  el.className = 'sync s-' + Cloud.state;
  const st = $('#cloud-state');
  if (st) st.innerHTML = cloudStateText();
}
Cloud.onState(showSync);
showSync();

// Änderungen von anderen Geräten → neu zeichnen (aber nicht mitten im Tippen)
let pendingRender = false;
Cloud.onRemoteChange(() => {
  const a = document.activeElement;
  if (document.querySelector('.modal-backdrop') || (a && a.closest('#app') && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { pendingRender = true; return; }
  render();
});
document.addEventListener('focusout', () => { if (pendingRender && !document.querySelector('.modal-backdrop')) { pendingRender = false; setTimeout(render, 50); } });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render().then(() => Cloud.sync());
