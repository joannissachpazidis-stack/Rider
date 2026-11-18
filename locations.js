'use strict';
/* ======================================================================
   Locations: Spielorte mit eigenen Ridern (Hausrider, Tech Specs, Bühnenpläne).
   Die wichtigsten Eckdaten werden automatisch ausgelesen (venue.js) und
   direkt auf der Karte angezeigt. Konzerte/Festivals können eine Location haben.
   Locations und ihre Rider sind – wie Bands – für das ganze Team sichtbar.
   ====================================================================== */
const Loc = (() => {
  const TYPES = ['Technikrider', 'Bühnenplan', 'Lageplan', 'Sonstiges'];
  const shortText = (s, n = 34) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const newestFirst = (docs) => docs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const order = (key) => { const i = Venue.FIELDS.findIndex((f) => f.key === key); return i < 0 ? 999 : i; };
  let showHidden = false;

  /* ---------- Erkannte Angaben + eigene Korrekturen ---------- */
  function factsFor(loc, docs) {
    const ed = loc.factEdits || {};
    const list = Venue.extract(newestFirst(docs)).map((f) => {
      const e = ed[f.key];
      if (!e) return f;
      const value = e.value ?? f.value;
      return { ...f, value, chip: f.chip ? (e.value ? shortText(e.value) : f.chip) : '', hidden: !!e.hidden, edited: e.value != null, auto: f.value };
    });
    // Von Hand ergänzte Angaben (im Rider nicht gefunden)
    for (const [key, e] of Object.entries(ed)) {
      if (!e.value || list.some((f) => f.key === key)) continue;
      const def = Venue.FIELDS.find((f) => f.key === key);
      if (def) list.push({ key, icon: def.icon, title: def.title, value: e.value, chip: def.chip ? shortText(e.value) : '', quotes: [], edited: true, manual: true, hidden: !!e.hidden });
    }
    list.sort((a, b) => order(a.key) - order(b.key));
    for (const c of loc.customFacts || []) list.push({ key: 'c:' + c.id, icon: '📝', title: c.title, value: c.value, quotes: [], custom: c.id });
    return list;
  }
  const chipsHtml = (facts, max = 8) => {
    const chips = facts.filter((f) => f.chip && !f.hidden).slice(0, max);
    return chips.length ? `<div class="lchips">${chips.map((f) => `<span class="lchip" title="${esc(f.title)}"><span>${f.icon}</span>${esc(f.chip)}</span>`).join('')}</div>` : '';
  };

  /* ---------- Liste ---------- */
  async function viewList() {
    setTab('locations');
    const [locs, docs, concerts] = await Promise.all([DB.all('locations'), Data.allDocs(), Data.concerts()]);
    locs.sort(byName);
    const t = today();
    const card = (l) => {
      const ld = docs.filter((d) => d.locationId === l.id && !d.archived);
      const facts = factsFor(l, ld);
      const next = concerts.filter((c) => c.locationId === l.id && c.date && c.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
      return `
      <a class="card loc-card" href="#/location/${l.id}">
        <div class="avatar">📍</div>
        <div class="grow">
          <div class="card-title">${esc(l.name)}</div>
          <div class="muted small">${[l.address && esc(l.address), next && `nächstes Konzert ${fmtDate(next.date)}`].filter(Boolean).join(' · ')}</div>
          ${chipsHtml(facts) || (ld.length ? '<p class="muted small">Im Rider wurden noch keine Eckdaten erkannt – tippe zum Ergänzen.</p>' : '<span class="badge warn">noch kein Rider</span>')}
        </div>
      </a>`;
    };
    app().innerHTML = `
      <div class="page-head"><h1>Locations</h1><button class="primary" data-newloc>+ Location</button></div>
      ${locs.length ? `<div class="list">${locs.map(card).join('')}</div>` : `
        <div class="empty"><div class="empty-icon">📍</div><p><b>Noch keine Locations.</b></p>
          <p class="muted">Lege eure Spielorte an und zieh den Hausrider bzw. das Tech Spec hinein – Kapazität, Bühne, PA, Pult, Stagebox, Monitoring usw. werden automatisch ausgelesen.</p></div>`}`;
    $('[data-newloc]').onclick = async () => { const l = await dialog(); if (l) location.hash = '#/location/' + l.id; };
  }

  /* ---------- Detail ---------- */
  async function view(id) {
    setTab('locations');
    const l = await DB.get('locations', id);
    if (!l) { app().innerHTML = '<p>Location nicht gefunden. <a href="#/locations">Zurück</a></p>'; return; }
    const [docs, concerts] = await Promise.all([Data.docsOfLocation(id), Data.concerts()]);
    const active = newestFirst(docs.filter((d) => !d.archived));
    const archived = newestFirst(docs.filter((d) => d.archived));
    const facts = factsFor(l, active);
    const hidden = facts.filter((f) => f.hidden);
    const t = today();
    const here = concerts.filter((c) => c.locationId === id && !c.festivalId);
    const up = here.filter((c) => !c.date || c.date >= t).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    const past = here.filter((c) => c.date && c.date < t).sort((a, b) => b.date.localeCompare(a.date));
    const crow = (c) => `<a class="card row-card" href="#/concert/${c.id}"><span class="grow"><b>${esc(c.title)}</b><br><span class="muted small">${[c.date && fmtDate(c.date), c.time && esc(c.time) + ' Uhr'].filter(Boolean).join(' · ')}</span></span></a>`;

    app().innerHTML = `
      <a class="back" href="#/locations">‹ Locations</a>
      <div class="page-head">
        <div><h1>📍 ${esc(l.name)}</h1>${l.address ? `<div class="muted">${esc(l.address)}</div>` : ''}</div>
        <div class="head-actions"><button class="ghost" data-editloc>Bearbeiten</button><button class="ghost danger-text" data-delloc>Löschen</button></div>
      </div>
      ${l.contact ? `<div class="notes"><b>Kontakt:</b> ${esc(l.contact)}</div>` : ''}
      ${l.notes ? `<div class="notes">${esc(l.notes)}</div>` : ''}

      <div class="page-head"><h3 class="section">Auf einen Blick</h3><button class="ghost small-btn" data-addfact>+ Angabe</button></div>
      ${active.some((d) => d.text) ? '' : '<p class="muted small">Noch kein lesbarer Rider – zieh den Hausrider oder das Tech Spec hierher (PDF, Word, Excel, Text). Angaben kannst du auch von Hand ergänzen.</p>'}
      <div class="facts">${facts.filter((f) => showHidden || !f.hidden).map((f) => `
        <div class="fact ${f.hidden ? 'is-hidden' : ''} ${f.edited || f.custom ? 'is-edited' : ''}">
          <div class="fact-head"><span class="fact-icon">${f.icon}</span><span class="fact-title">${esc(f.title)}</span>
            <button class="icon fact-edit" data-lfact="${esc(f.custom || f.key)}" data-custom="${f.custom ? 1 : ''}" title="Korrigieren / ausblenden" aria-label="${esc(f.title)} bearbeiten">✎</button></div>
          <div class="fact-value">${esc(f.value)}</div>
          ${f.edited && !f.manual ? `<div class="fact-auto small">von dir korrigiert · erkannt: ${esc(f.auto)}</div>` : ''}
          ${f.manual ? '<div class="fact-auto small">von dir ergänzt</div>' : ''}
          ${f.quotes.length ? `<details class="quotes"><summary>aus dem Rider</summary>${f.quotes.map((q) => `<q>${esc(q.length > 260 ? q.slice(0, 260) + '…' : q)}</q>`).join('')}</details>` : ''}
        </div>`).join('')}</div>
      ${hidden.length ? `<p class="small"><button class="link" data-lshowhidden>${showHidden ? 'Ausgeblendete verbergen' : `${hidden.length} ausgeblendete Angabe${hidden.length > 1 ? 'n' : ''} anzeigen`}</button></p>` : ''}

      <div class="page-head"><h3 class="section">Rider & Pläne</h3><button class="primary small-btn" data-locupload>⬆︎ Rider ablegen</button></div>
      ${active.length ? `<ul class="docs">${active.map((d) => docRow(d)).join('')}</ul>` : '<p class="muted small">Noch nichts abgelegt. Du kannst Dateien auch einfach auf diese Seite ziehen.</p>'}
      ${archived.length ? `<details class="section"><summary class="small muted">Veraltet (${archived.length})</summary><ul class="docs">${archived.map((d) => docRow(d)).join('')}</ul></details>` : ''}

      <h3 class="section">Konzerte hier</h3>
      ${up.length ? `<div class="list">${up.map(crow).join('')}</div>` : '<p class="muted small">Kein anstehendes Konzert. Beim Anlegen oder Bearbeiten eines Konzerts kannst du diese Location auswählen.</p>'}
      ${past.length ? `<details class="section"><summary class="small muted">Vergangen (${past.length})</summary><div class="list">${past.map(crow).join('')}</div></details>` : ''}`;

    $('[data-editloc]').onclick = () => dialog(l);
    $('[data-delloc]').onclick = () => remove(l, docs);
    $('[data-locupload]').onclick = async () => { const f = await Smart.pickFiles(); if (f.length) importFiles(f, id); };
    $('[data-addfact]').onclick = () => factDialog(l, active, null);
    $$('[data-lfact]').forEach((b) => (b.onclick = () => factDialog(l, active, b.dataset.lfact, !!b.dataset.custom)));
    const sh = $('[data-lshowhidden]');
    if (sh) sh.onclick = () => { showHidden = !showHidden; render(); };
    bindDocActions(app());
  }

  /* ---------- Anlegen / Bearbeiten / Löschen ---------- */
  async function dialog(l = null) {
    const res = await modal(`
      <div class="modal-head"><h2>${l ? 'Location bearbeiten' : 'Neue Location'}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form" novalidate>
        <label>Name <input name="name" required value="${esc(l?.name)}" placeholder="z. B. Jugendhaus Kesselhaus / Club XY" autofocus></label>
        <label>Adresse <input name="address" value="${esc(l?.address)}" placeholder="Straße, Ort"></label>
        <label>Kontakt (Haustechnik) <input name="contact" value="${esc(l?.contact)}" placeholder="Name, Telefon, E-Mail"></label>
        <label>Notizen <textarea name="notes" rows="3" placeholder="Anfahrt, Schlüssel, Besonderheiten …">${esc(l?.notes)}</textarea></label>
        <p class="error" hidden></p>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">${l ? 'Speichern' : 'Anlegen'}</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.elements.namedItem('name').value.trim();
        if (!name) { const er = $('.error', el); er.textContent = 'Bitte einen Namen angeben.'; er.hidden = false; return; }
        done({ name, address: f.address.value.trim(), contact: f.contact.value.trim(), notes: f.notes.value.trim() });
      };
    });
    if (!res) return null;
    const loc = l ? Object.assign(l, res) : { id: uid(), ...res, createdAt: nowIso() };
    await DB.put('locations', loc);
    if (l) render();
    return loc;
  }

  async function remove(l, docs) {
    const concerts = (await Data.concerts()).filter((c) => c.locationId === l.id);
    if (!(await confirmDialog(`Location „${esc(l.name)}“ löschen?${docs.length ? ` Ihre ${docs.length} Unterlage${docs.length > 1 ? 'n werden' : ' wird'} mitgelöscht.` : ''}${concerts.length ? ` Die ${concerts.length} Konzert${concerts.length > 1 ? 'e bleiben' : ' bleibt'} erhalten.` : ''}`, 'Löschen', true))) return;
    for (const d of docs) await DB.del('docs', d.id);
    for (const c of concerts) { delete c.locationId; await DB.put('concerts', c); }
    await DB.del('locations', l.id);
    location.hash = '#/locations';
  }

  /* ---------- Angaben korrigieren / ergänzen ---------- */
  async function factDialog(l, docs, key, custom = false) {
    const auto = key && !custom ? Venue.extract(newestFirst(docs)).find((f) => f.key === key) : null;
    const cf = custom ? (l.customFacts || []).find((c) => c.id === key) : null;
    const cur = custom ? cf : key ? (l.factEdits || {})[key] : null;
    const def = key && !custom ? Venue.FIELDS.find((f) => f.key === key) : null;
    const isNew = !key;
    const res = await modal(`
      <div class="modal-head"><h2>${isNew ? 'Angabe ergänzen' : custom ? 'Eigene Angabe' : esc(def?.title || key)}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        ${isNew ? `<label>Was? <select name="field">${Venue.FIELDS.map((f) => `<option value="${f.key}">${f.icon} ${esc(f.title)}</option>`).join('')}<option value="__custom">📝 Eigene Angabe …</option></select></label>
          <label class="ctitle" hidden>Titel <input name="title" placeholder="z. B. Schlüssel, WLAN, Catering"></label>` : ''}
        ${custom ? `<label>Titel <input name="title" value="${esc(cf?.title || '')}" required></label>` : ''}
        ${auto ? `<p class="small muted">Erkannt: <b>${esc(auto.value)}</b></p>` : ''}
        <label>${auto ? 'Richtiger Wert' : 'Wert'} <input name="value" value="${esc(cur?.value ?? auto?.value ?? '')}" autofocus></label>
        ${!isNew && !custom ? `<label class="check"><input type="checkbox" name="hidden" ${cur?.hidden ? 'checked' : ''}> Diese Angabe ausblenden</label>` : ''}
        <div class="actions">
          ${cf ? '<button type="button" class="ghost danger-text" data-del>Löschen</button>' : ''}
          ${!custom && cur ? '<button type="button" class="ghost" data-reset>Zurücksetzen</button>' : ''}
          <span class="grow"></span>
          <button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      const sel = f.elements.namedItem('field');
      if (sel) sel.onchange = () => ($('.ctitle', el).hidden = sel.value !== '__custom');
      f.onsubmit = (e) => {
        e.preventDefault();
        const g = (n) => f.elements.namedItem(n);
        done({ field: sel?.value, title: g('title')?.value.trim(), value: g('value').value.trim(), hidden: !!g('hidden')?.checked });
      };
      const d = $('[data-del]', el); if (d) d.onclick = () => done('delete');
      const r = $('[data-reset]', el); if (r) r.onclick = () => done('reset');
    });
    if (!res) return;
    if (custom || res.field === '__custom') {
      l.customFacts = (l.customFacts || []).filter((c) => c.id !== cf?.id);
      if (res !== 'delete' && res.title && res.value) l.customFacts.push({ id: cf?.id || uid(), title: res.title, value: res.value });
    } else {
      const k = key || res.field;
      l.factEdits ||= {};
      if (res === 'reset') delete l.factEdits[k];
      else l.factEdits[k] = { value: res.value && res.value !== auto?.value ? res.value : null, hidden: !!res.hidden };
      if (!l.factEdits[k]?.value && !l.factEdits[k]?.hidden) delete l.factEdits[k];
    }
    await DB.put('locations', l);
    render();
  }

  /* ---------- Rider ablegen ---------- */
  async function importFiles(fileList, locId) {
    const files = [...fileList].filter((f) => f.size > 0);
    if (!files.length) return;
    const existing = await Data.docsOfLocation(locId);
    const pr = Smart.progress('Lese Rider …');
    let saved = 0, dup = 0;
    try {
      for (const f of files) {
        pr.update(`Lese ${f.name} …`);
        const info = await Smart.analyzeBlob(f, f.name, f.type);
        if (existing.some((d) => d.fileHash && d.fileHash === info.hash)) { dup++; continue; }
        const type = /lage|anfahrt|map|karte/i.test(f.name) ? 'Lageplan' : /plan|grundriss|stage\s?plot|floor|layout|zeichnung|drawing/i.test(f.name) ? 'Bühnenplan' : 'Technikrider';
        const doc = {
          id: uid(), locationId: locId, type, title: f.name.replace(/\.[^.]+$/, ''),
          date: (Smart.extractDate && Smart.extractDate(info.text)) || today(), notes: '', archived: false,
          confirmedAt: nowIso(), createdAt: nowIso(), fileName: f.name, mime: f.type || '', size: f.size, blob: f,
          fileHash: info.hash, text: info.text,
        };
        await DB.put('docs', doc);
        existing.push(doc);
        saved++;
      }
    } finally { pr.close(); }
    toast([saved && `${saved} Datei${saved > 1 ? 'en' : ''} abgelegt – Eckdaten werden ausgelesen`, dup && `${dup} schon vorhanden`].filter(Boolean).join(' · ') || 'Nichts abgelegt');
    render();
  }

  /* ---------- Für Konzerte/Festivals ---------- */
  // Auswahlfeld für Formulare
  async function selectHtml(currentId) {
    const locs = (await DB.all('locations')).sort(byName);
    if (!locs.length) return '';
    return `<label>Location <select name="locationId"><option value="">– keine –</option>${locs.map((l) => `<option value="${l.id}" ${l.id === currentId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`;
  }
  // Ist die Venue noch leer, wird sie beim Auswählen der Location ausgefüllt
  async function bindSelect(form) {
    const sel = form.elements.namedItem('locationId');
    const venue = form.elements.namedItem('venue');
    if (!sel || !venue) return;
    const locs = await DB.all('locations');
    sel.addEventListener('change', () => {
      const l = locs.find((x) => x.id === sel.value);
      if (l && !venue.value.trim()) venue.value = [l.name, (l.address || '').split(',').pop().trim()].filter(Boolean).join(', ');
    });
  }
  // Kompakte Karte mit den Eckdaten (im Konzert/Festival)
  async function mini(id) {
    if (!id) return '';
    const l = await DB.get('locations', id);
    if (!l) return '';
    const docs = (await Data.docsOfLocation(id)).filter((d) => !d.archived);
    const facts = factsFor(l, docs);
    return `
      <a class="card loc-mini" href="#/location/${l.id}">
        <div><b>📍 ${esc(l.name)}</b>${l.address ? ` <span class="muted small">${esc(l.address)}</span>` : ''}</div>
        ${chipsHtml(facts, 10) || `<p class="muted small">${docs.length ? 'Keine Eckdaten erkannt – tippe zum Ergänzen.' : 'Noch kein Rider der Location abgelegt.'}</p>`}
      </a>`;
  }

  return { viewList, view, importFiles, selectHtml, bindSelect, mini, factsFor, TYPES };
})();
