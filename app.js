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

/* ---------------- Upload ---------------- */
/**
 * Neue Unterlagen ablegen.
 * opts: { bandId?, concertId?, type?, hint? }
 * Wenn concertId gesetzt ist, werden die Dateien direkt dem Konzert zugeordnet.
 */
async function uploadDialog(opts = {}) {
  const bands = (await Data.bands()).sort(byName);
  const fixedBand = opts.bandId ? bands.find((b) => b.id === opts.bandId) : null;
  let files = [];

  const res = await modal(`
    <div class="modal-head"><h2>Unterlagen ablegen</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
    ${opts.hint ? `<p class="hint">${opts.hint}</p>` : ''}
    <form class="form" novalidate>
      ${fixedBand ? `<p><b>Band:</b> ${esc(fixedBand.name)}</p>` : `
      <label>Band
        <input name="band" list="dl-bands" required autocomplete="off" placeholder="Bandname" autofocus>
        <datalist id="dl-bands">${bands.map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      </label>`}
      <label>Art
        <select name="type">${DOC_TYPES.map((t) => `<option ${t === (opts.type || 'Techrider') ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
      <div class="drop" tabindex="0">
        <input type="file" name="file" multiple hidden>
        <div class="drop-text">📄 Dateien hierher ziehen oder <u>auswählen</u><br><span class="muted small">PDF, Bilder, Text, Excel … (mehrere möglich)</span></div>
        <ul class="file-list"></ul>
      </div>
      <label>Titel <input name="title" placeholder="wird aus dem Dateinamen übernommen"></label>
      <label>Stand / Datum des Riders <input type="date" name="date" value="${today()}"></label>
      <label>Notizen <textarea name="notes" rows="3" placeholder="z. B. bringen eigenes Pult mit, IEM über eigenes Rack …"></textarea></label>
      <label class="check"><input type="checkbox" name="archiveOld" checked> Ältere Unterlagen derselben Art als <i>veraltet</i> markieren</label>
      <p class="error" hidden></p>
      <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
    </form>`, (el, done) => {
    const form = $('form', el);
    const input = $('input[type=file]', el);
    const drop = $('.drop', el);
    const list = $('.file-list', el);
    const showFiles = () => {
      list.innerHTML = files.map((f, i) => `<li>${esc(f.name)} <span class="muted small">${fmtSize(f.size)}</span> <button type="button" class="link" data-rm="${i}">entfernen</button></li>`).join('');
      $$('[data-rm]', list).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); files.splice(+b.dataset.rm, 1); showFiles(); }));
      if (files.length === 1 && !form.title.value) form.title.placeholder = files[0].name.replace(/\.[^.]+$/, '');
    };
    const addFiles = (fl) => { files.push(...fl); showFiles(); guessType(); };
    const guessType = () => {
      const n = norm(files.map((f) => f.name).join(' '));
      const guess = [['input', 'Inputliste'], ['channel', 'Inputliste'], ['stageplot', 'Stageplot'], ['buhnen', 'Stageplot'], ['plot', 'Stageplot'],
        ['monitor', 'Monitoring'], ['licht', 'Lichtrider'], ['light', 'Lichtrider'], ['hospi', 'Hospitality'], ['catering', 'Hospitality'],
        ['tech', 'Techrider'], ['rider', 'Techrider']].find(([k]) => n.includes(k));
      if (guess && !opts.type) form.type.value = guess[1];
    };
    drop.onclick = (e) => { if (!e.target.closest('button')) input.click(); };
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { addFiles([...input.files]); input.value = ''; };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
    if (opts.files) addFiles(opts.files);

    form.onsubmit = (e) => {
      e.preventDefault();
      const err = $('.error', el);
      const bandName = fixedBand ? fixedBand.name : form.band.value.trim();
      if (!bandName) { err.textContent = 'Bitte eine Band angeben.'; err.hidden = false; return; }
      if (!files.length && !form.notes.value.trim()) { err.textContent = 'Bitte eine Datei auswählen oder eine Notiz schreiben.'; err.hidden = false; return; }
      done({
        bandName, type: form.type.value, title: form.title.value.trim(), date: form.date.value,
        notes: form.notes.value.trim(), archiveOld: form.archiveOld.checked,
      });
    };
  });
  if (!res) return [];

  const band = fixedBand || (await Data.findOrCreateBand(res.bandName)).band;
  const created = [];
  const items = files.length ? files : [null];
  for (const f of items) {
    const doc = {
      id: uid(), bandId: band.id, type: res.type,
      title: (items.length === 1 && res.title) || (f ? f.name.replace(/\.[^.]+$/, '') : res.title || res.type),
      date: res.date, notes: res.notes, archived: false, confirmedAt: nowIso(), createdAt: nowIso(),
      fileName: f?.name || '', mime: f?.type || '', size: f?.size || 0, blob: f || null,
    };
    await DB.put('docs', doc);
    created.push(doc);
  }
  const newIds = created.map((d) => d.id);
  let replaced = [];
  if (res.archiveOld) {
    replaced = (await Data.docsOfBand(band.id)).filter((d) => d.type === res.type && !d.archived && !newIds.includes(d.id));
    for (const d of replaced) { d.archived = true; await DB.put('docs', d); }
  }
  if (opts.concertId) {
    const c = await DB.get('concerts', opts.concertId);
    const entry = c?.lineup.find((e) => e.bandId === band.id);
    if (entry) {
      const replacedIds = replaced.map((d) => d.id);
      entry.docIds = entry.docIds.filter((id) => !replacedIds.includes(id)).concat(newIds);
      await DB.put('concerts', c);
    }
  }
  toast(created.length === 1 ? 'Gespeichert' : `${created.length} Dateien gespeichert`);
  return created;
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
      <div class="actions"><button class="ghost" data-close>Schließen</button><button class="primary" data-up>Neue Unterlagen hochladen</button></div>`,
    (el, done) => ($('[data-up]', el).onclick = () => done(true)));
    if (r) await uploadDialog({ bandId, concertId });
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
    await uploadDialog({
      bandId, concertId, type: [...oldTypes][0],
      hint: `Veraltet markiert: <b>${[...oldTypes].map(esc).join(', ')}</b>. Lade hier gleich die neue Version hoch (oder später über das Konzert).`,
    });
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
        <label>Ort / Venue <input name="venue" value="${esc(concert?.venue)}" placeholder="Club, Stadt"></label>
      </div>
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
      done({ title, date: form.date.value, venue: form.venue.value.trim(), notes: form.notes.value.trim() });
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
    if (!c.lineup.some((e) => e.bandId === band.id)) c.lineup.push({ bandId: band.id, time: '', docIds: [] });
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
  c.lineup.push({ bandId: band.id, time: '', docIds: [] });
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
async function viewConcerts() {
  setTab('concerts');
  const [concerts, bands, docs] = await Promise.all([Data.concerts(), Data.bands(), Data.docs()]);
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const t = today();
  const upcoming = concerts.filter((c) => (c.date || '9999') >= t).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = concerts.filter((c) => (c.date || '9999') < t).sort((a, b) => b.date.localeCompare(a.date));

  const card = (c) => {
    const missing = c.lineup.filter((e) => !e.docIds.some((id) => docMap.has(id))).length;
    const outdated = c.lineup.some((e) => e.docIds.some((id) => docMap.get(id)?.archived));
    const nDocs = c.lineup.reduce((n, e) => n + e.docIds.filter((id) => docMap.has(id)).length, 0);
    return `
    <a class="card concert-card" href="#/concert/${c.id}">
      <div class="date-box">${c.date ? `<span>${fmtWeekday(c.date)}</span><b>${toDate(c.date).getDate()}</b><span>${toDate(c.date).toLocaleDateString('de-DE', { month: 'short' })}</span>` : '<b>?</b>'}</div>
      <div class="grow">
        <div class="card-title">${esc(c.title)}</div>
        <div class="muted small">${[c.venue && esc(c.venue), c.date && fmtDate(c.date)].filter(Boolean).join(' · ')}</div>
        <div class="small">${c.lineup.map((e) => esc(bandMap.get(e.bandId)?.name)).join(' · ') || '<span class="muted">noch keine Bands</span>'}</div>
        <div class="badges">
          <span class="badge">${nDocs} Unterlagen</span>
          ${missing ? `<span class="badge warn">${missing} ohne Rider</span>` : c.lineup.length ? '<span class="badge ok">komplett</span>' : ''}
          ${outdated ? '<span class="badge warn">veraltete Unterlagen</span>' : ''}
        </div>
      </div>
    </a>`;
  };

  app().innerHTML = `
    <div class="page-head"><h1>Konzerte</h1><button class="primary" data-new>+ Neues Konzert</button></div>
    ${!concerts.length ? `
      <div class="empty">
        <p>Noch keine Konzerte angelegt.</p>
        <p class="muted">Lege ein Konzert an und trag die Bands ein – wenn es für eine Band schon einen Rider gibt, wirst du gefragt, ob er noch aktuell ist, und er wird direkt zugeordnet.</p>
      </div>` : ''}
    ${upcoming.length ? `<h3 class="section">Anstehend</h3><div class="list">${upcoming.map(card).join('')}</div>` : ''}
    ${past.length ? `<details class="section" ${upcoming.length ? '' : 'open'}><summary><h3>Vergangen (${past.length})</h3></summary><div class="list">${past.map(card).join('')}</div></details>` : ''}`;
  $('[data-new]').onclick = () => concertDialog();
}

async function viewConcert(id) {
  setTab('concerts');
  const c = await DB.get('concerts', id);
  if (!c) { app().innerHTML = '<p>Konzert nicht gefunden. <a href="#/concerts">Zurück</a></p>'; return; }
  const [bands, docs] = await Promise.all([Data.bands(), Data.docs()]);
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const docMap = new Map(docs.map((d) => [d.id, d]));

  const entryHtml = (e, i) => {
    const b = bandMap.get(e.bandId);
    const eDocs = e.docIds.map((x) => docMap.get(x)).filter(Boolean);
    const newer = docs.filter((d) => d.bandId === e.bandId && !d.archived && !e.docIds.includes(d.id));
    const hasOutdated = eDocs.some((d) => d.archived);
    return `
    <div class="card lineup" data-band="${e.bandId}">
      <div class="lineup-head">
        <input type="time" class="time" value="${esc(e.time)}" data-time="${i}" aria-label="Spielzeit">
        <a class="card-title grow" href="#/band/${e.bandId}">${esc(b?.name || '?')}</a>
        <button class="icon" title="nach oben" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon" title="nach unten" data-down="${i}" ${i === c.lineup.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon" title="Band aus Konzert entfernen" data-rmband="${i}">✕</button>
      </div>
      ${b?.genre ? `<div class="muted small">${esc(b.genre)}</div>` : ''}
      ${eDocs.length ? `<ul class="docs">${eDocs.map((d) => docRow(d, { concertId: c.id })).join('')}</ul>`
        : '<p class="warn-text small">Noch keine Unterlagen für dieses Konzert.</p>'}
      ${hasOutdated ? '<p class="warn-text small">Mindestens eine Unterlage ist als veraltet markiert – neue Version hochladen?</p>' : ''}
      <div class="lineup-actions">
        ${newer.length ? `<button class="ghost small-btn" data-check="${e.bandId}">📂 Aus Ablage (${newer.length})</button>` : ''}
        <button class="ghost small-btn" data-upload="${e.bandId}">⬆︎ Hochladen</button>
      </div>
    </div>`;
  };

  app().innerHTML = `
    <a class="back" href="#/concerts">‹ Konzerte</a>
    <div class="page-head">
      <div><h1>${esc(c.title)}</h1>
        <div class="muted">${[c.date && fmtWeekday(c.date) + ', ' + fmtDate(c.date), c.venue && esc(c.venue)].filter(Boolean).join(' · ')}</div></div>
      <div class="head-actions"><button class="ghost" data-editc>Bearbeiten</button><button class="ghost danger-text" data-delc>Löschen</button></div>
    </div>
    ${c.notes ? `<div class="notes">${esc(c.notes)}</div>` : ''}
    <h3 class="section">Line-up</h3>
    <div class="list">${c.lineup.map(entryHtml).join('') || '<p class="muted">Noch keine Bands.</p>'}</div>
    <form class="add-band card" autocomplete="off">
      <input name="band" list="dl-addband" placeholder="Band hinzufügen …">
      <datalist id="dl-addband">${bands.filter((b) => !c.lineup.some((e) => e.bandId === b.id)).sort(byName).map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      <button class="primary">+ Band</button>
    </form>`;

  const save = async () => { await DB.put('concerts', c); render(); };
  $('[data-editc]').onclick = () => concertDialog(c);
  $('[data-delc]').onclick = async () => {
    if (await confirmDialog(`Konzert „${esc(c.title)}“ löschen? Die Rider bleiben bei den Bands gespeichert.`, 'Löschen', true)) {
      await DB.del('concerts', c.id);
      location.hash = '#/concerts';
    }
  };
  $$('[data-time]').forEach((inp) => (inp.onchange = () => { c.lineup[+inp.dataset.time].time = inp.value; DB.put('concerts', c); }));
  $$('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [c.lineup[i - 1], c.lineup[i]] = [c.lineup[i], c.lineup[i - 1]]; save(); }));
  $$('[data-down]').forEach((b) => (b.onclick = () => { const i = +b.dataset.down; [c.lineup[i + 1], c.lineup[i]] = [c.lineup[i], c.lineup[i + 1]]; save(); }));
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
  $$('[data-upload]').forEach((b) => (b.onclick = async () => { await uploadDialog({ bandId: b.dataset.upload, concertId: c.id }); render(); }));
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

async function viewBand(id) {
  setTab('bands');
  const b = await DB.get('bands', id);
  if (!b) { app().innerHTML = '<p>Band nicht gefunden. <a href="#/bands">Zurück</a></p>'; return; }
  const [docs, concerts] = await Promise.all([Data.docsOfBand(id), Data.concerts()]);
  const active = docs.filter((d) => !d.archived);
  const archived = docs.filter((d) => d.archived).sort((a, x) => (x.date || '').localeCompare(a.date || ''));
  const groups = DOC_TYPES.map((t) => [t, active.filter((d) => d.type === t).sort((a, x) => (x.date || '').localeCompare(a.date || ''))]).filter(([, l]) => l.length);
  const bc = concerts.filter((c) => c.lineup.some((e) => e.bandId === id)).sort((a, x) => (x.date || '').localeCompare(a.date || ''));

  app().innerHTML = `
    <a class="back" href="#/bands">‹ Bands</a>
    <div class="page-head">
      <div><h1>${esc(b.name)}</h1>${b.genre ? `<div class="muted">${esc(b.genre)}</div>` : ''}</div>
      <div class="head-actions"><button class="ghost" data-editb>Bearbeiten</button><button class="ghost danger-text" data-delb>Löschen</button></div>
    </div>
    ${b.contact ? `<div class="notes"><b>Kontakt:</b> ${esc(b.contact)}</div>` : ''}
    ${b.notes ? `<div class="notes">${esc(b.notes)}</div>` : ''}
    <div class="page-head"><h3 class="section">Aktuelle Unterlagen</h3><button class="primary" data-upload>⬆︎ Hochladen</button></div>
    ${groups.length ? groups.map(([t, l]) => `<ul class="docs">${l.map((d) => docRow(d)).join('')}</ul>`).join('')
      : '<p class="muted">Noch keine Unterlagen. Lade Techrider, Inputliste, Stageplot o. ä. hoch.</p>'}
    ${archived.length ? `<details class="section"><summary><h3>Veraltete Versionen (${archived.length})</h3></summary><ul class="docs">${archived.map((d) => docRow(d)).join('')}</ul></details>` : ''}
    <h3 class="section">Konzerte</h3>
    <div class="list">${bc.map((c) => `<a class="card row-card" href="#/concert/${c.id}"><span class="grow"><b>${esc(c.title)}</b><br><span class="muted small">${[fmtDate(c.date), c.venue && esc(c.venue)].filter(Boolean).join(' · ')}</span></span><span class="badge">${c.lineup.find((e) => e.bandId === id).docIds.length} Unterlagen</span></a>`).join('') || '<p class="muted">Noch in keinem Konzert.</p>'}</div>`;

  $('[data-editb]').onclick = async () => { if (await bandDialog(b)) render(); };
  $('[data-delb]').onclick = async () => {
    if (await confirmDialog(`Band „${esc(b.name)}“ mit allen ${docs.length} Unterlagen löschen? Sie wird auch aus allen Konzerten entfernt.`, 'Löschen', true)) {
      await Data.deleteBand(id);
      location.hash = '#/bands';
    }
  };
  $('[data-upload]').onclick = async () => { await uploadDialog({ bandId: id }); render(); };
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
    <input class="search" type="search" placeholder="Bands, Konzerte, Orte, Dateien, Notizen …" value="${esc(searchQuery)}" autofocus>
    <div class="results"></div>`;
  const out = $('.results');
  const draw = () => {
    const terms = searchQuery.split(/\s+/).map(norm).filter(Boolean);
    if (!terms.length) { out.innerHTML = '<p class="muted">Tipp: Mehrere Begriffe kombinieren, z. B. „inputliste muster“.</p>'; return; }
    // Treffer, wenn jeder Begriff ein Wortanfang ist (ab 4 Zeichen auch mitten im Wort)
    const hit = (text) => {
      const words = String(text ?? '').split(/[\s\-_.,/()]+/).map(norm).filter(Boolean);
      const all = words.join('');
      return terms.every((t) => words.some((w) => w.startsWith(t)) || (t.length >= 4 && all.includes(t)));
    };
    const rb = bands.filter((b) => hit([b.name, b.genre, b.contact, b.notes].join(' '))).sort(byName);
    const rc = concerts.filter((c) => hit([c.title, c.venue, c.notes, c.date, fmtDate(c.date), ...c.lineup.map((e) => bandMap.get(e.bandId)?.name)].join(' ')))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const rd = docs.filter((d) => hit([d.title, d.type, d.notes, d.fileName, bandMap.get(d.bandId)?.name].join(' ')))
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
  const [bands, docs, concerts] = await Promise.all([Data.bands(), Data.docs(), Data.concerts()]);
  const docsOut = [];
  for (const d of docs) docsOut.push({ ...d, blob: undefined, data: d.blob ? await blobToDataURL(d.blob) : null });
  const json = JSON.stringify({ app: 'rider-ablage', version: 1, exportedAt: nowIso(), bands, concerts, docs: docsOut });
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
  for (const d of data.docs) {
    const { data: dataUrl, ...rest } = d;
    rest.blob = dataUrl ? await (await fetch(dataUrl)).blob() : null;
    await DB.put('docs', rest);
  }
  toast('Backup eingespielt');
  render();
}

async function viewMore() {
  setTab('more');
  const [bands, docs, concerts] = await Promise.all([Data.bands(), Data.docs(), Data.concerts()]);
  const size = docs.reduce((n, d) => n + (d.size || 0), 0);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const last = localStorage.getItem('lastBackup');
  app().innerHTML = `
    <div class="page-head"><h1>Ablage & Backup</h1></div>
    <div class="stats">
      <div class="card stat"><b>${concerts.length}</b><span>Konzerte</span></div>
      <div class="card stat"><b>${bands.length}</b><span>Bands</span></div>
      <div class="card stat"><b>${docs.length}</b><span>Unterlagen</span></div>
      <div class="card stat"><b>${fmtSize(size) || '0 KB'}</b><span>Dateien</span></div>
    </div>
    <div class="card">
      <h3>Backup</h3>
      <p class="muted small">Alle Daten liegen nur in diesem Browser auf diesem Gerät. Mach regelmäßig ein Backup – damit kannst du die Ablage auch auf ein anderes Gerät übertragen.</p>
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
  $('[data-export]').onclick = exportAll;
  $('[data-import]').onchange = (e) => e.target.files[0] && importAll(e.target.files[0]);
  const p = $('[data-persist]');
  if (p) p.onclick = async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Dauerhafter Speicher aktiv' : 'Vom Browser abgelehnt – App zum Home-Bildschirm hinzufügen hilft oft'); render(); };
}

/* ---------------- Router ---------------- */
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const [, view, id] = (location.hash || '#/concerts').split('/');
  const scroll = window.scrollY;
  const sameView = render.last === location.hash;
  render.last = location.hash;
  const views = { concerts: viewConcerts, concert: () => viewConcert(id), bands: viewBands, band: () => viewBand(id), search: viewSearch, more: viewMore };
  await (views[view] || viewConcerts)();
  if (seq === renderSeq) window.scrollTo(0, sameView ? scroll : 0);
}

window.addEventListener('hashchange', render);

// Dateien auf die Seite ziehen → direkt ablegen (Band/Konzert wird vorbelegt, wenn möglich)
window.addEventListener('dragover', (e) => { if (!document.querySelector('.modal-backdrop') && e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (document.querySelector('.modal-backdrop') || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  const [, view, id] = location.hash.split('/');
  const target = e.target.closest?.('[data-band]');
  const opts = { files: [...e.dataTransfer.files] };
  if (view === 'band') opts.bandId = id;
  if (view === 'concert' && target) { opts.bandId = target.dataset.band; opts.concertId = id; }
  await uploadDialog(opts);
  render();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
