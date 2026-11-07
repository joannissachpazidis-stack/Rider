'use strict';
/* ======================================================================
   Oberfläche: Mix-Infos, Inputliste, Patchplan und Stagebox-Profile
   ====================================================================== */
const PatchUI = (() => {
  let editing = null; // Band-ID, deren Inputliste gerade bearbeitet wird
  let hideEmpty = localStorage.getItem('patch.hideEmpty') === '1';

  const HOW = {
    exact: ['✓', 'ok', 'passt genau'],
    class: ['✓', 'ok', 'gleiches Instrument'],
    similar: ['≈', 'similar', 'ähnlich (z. B. Kick → Kick In)'],
    family: ['~', 'similar', 'gleiche Gruppe'],
    free: ['＋', 'free', 'auf freien Kanal gelegt'],
    manual: ['✎', 'manual', 'von dir zugeordnet'],
    overflow: ['!', 'warn', 'passt nicht mehr in die Stagebox'],
  };

  const rowsOf = (b, docs) => Patch.bandInputs(b, docs);

  /* ---------- Bereich „Überblick“: Mix-Infos + Inputliste ---------- */
  function overview(b, docs) {
    const inp = rowsOf(b, docs);
    const facts = Patch.insights(docs, inp.rows);
    const isEdit = editing === b.id;
    const src = inp.source;
    return `
      <h3 class="section">Für den Mix</h3>
      ${docs.some((d) => !d.archived && d.text) ? '' : '<p class="muted small">Noch kein lesbarer Rider abgelegt – die Infos erscheinen, sobald ein Rider (PDF, Word, Excel, Text) da ist.</p>'}
      <div class="facts">${facts.map((f) => `
        <div class="fact lvl-${f.level}">
          <div class="fact-head"><span class="fact-icon">${f.icon}</span><span class="fact-title">${esc(f.title)}</span></div>
          <div class="fact-value">${esc(f.value)}</div>
          ${f.quotes.length ? `<details class="quotes"><summary>aus dem Rider</summary>${f.quotes.map((q) => `<q>${esc(q.length > 220 ? q.slice(0, 220) + '…' : q)}</q>`).join('')}</details>` : ''}
        </div>`).join('')}</div>

      <div class="page-head"><h3 class="section">Inputliste der Band</h3>
        <div class="head-actions no-print">${isEdit ? '' : `<button class="ghost small-btn" data-inedit>✎ Bearbeiten</button>
          ${inp.rows.length ? `<a class="button primary small-btn" href="#/band/${b.id}/patch">🎛 Patch erstellen</a>` : ''}`}</div></div>
      <p class="muted small">${src ? `Gelesen aus „${esc(src.title)}“${src.date ? ' (Stand ' + fmtDate(src.date) + ')' : ''}` : 'Keine Inputliste im Rider gefunden.'}${inp.edited ? ' · <span class="badge accent">von dir bearbeitet</span>' : ''}
        ${inp.rows.length ? ' · Kanalnummern laut Band (z. B. ihr In-Ear-Rack / Split)' : ''}</p>
      ${inp.newer ? `<p class="hint small">Es gibt einen neueren Rider („${esc(inp.newer.title)}“). <button class="link" data-reparse>Inputliste neu einlesen</button> (deine Änderungen gehen dabei verloren)</p>` : ''}
      ${isEdit ? editTable(inp.rows) : viewTable(inp.rows)}
      ${!isEdit && inp.edited ? '<p class="small no-print"><button class="link" data-reparse>Aus dem Rider neu einlesen</button></p>' : ''}`;
  }

  function viewTable(rows) {
    if (!rows.length) return '<p class="muted">Tippe auf „Bearbeiten“, um die Inputliste selbst anzulegen – oder „Liste einfügen“ und aus E-Mail/Excel hineinkopieren.</p>';
    return `<div class="table-wrap"><table class="ptable">
      <thead><tr><th>Ch</th><th>Quelle</th><th>Mikro / DI</th><th>Stativ</th><th>48V</th><th>Notiz</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="fam-${norm(Patch.classify(r.source).fam)}"><td class="ch">${r.ch}</td><td><b>${esc(r.source)}</b></td><td>${esc(r.mic)}</td><td>${esc(r.stand)}</td><td>${r.phantom ? '●' : ''}</td><td class="small">${esc(r.note)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  function editTable(rows) {
    return `<div class="table-wrap"><table class="ptable edit" data-intable>
      <thead><tr><th>Ch</th><th>Quelle</th><th>Mikro / DI</th><th>Stativ</th><th>48V</th><th>Notiz</th><th></th></tr></thead>
      <tbody>${rows.map(editRow).join('')}</tbody></table></div>
      <div class="actions left">
        <button class="ghost small-btn" data-inadd>+ Kanal</button>
        <button class="ghost small-btn" data-inpaste>📋 Liste einfügen</button>
        <span class="grow"></span>
        <button class="ghost" data-incancel>Abbrechen</button>
        <button class="primary" data-insave>Speichern</button>
      </div>`;
  }
  const editRow = (r) => `<tr>
    <td><input class="ch-in" type="number" min="1" max="128" value="${esc(r.ch)}" data-k="ch"></td>
    <td><input value="${esc(r.source)}" data-k="source" placeholder="z. B. Kick In"></td>
    <td><input value="${esc(r.mic)}" data-k="mic" placeholder="Beta 91"></td>
    <td><input value="${esc(r.stand)}" data-k="stand"></td>
    <td><input type="checkbox" data-k="phantom" ${r.phantom ? 'checked' : ''}></td>
    <td><input value="${esc(r.note)}" data-k="note"></td>
    <td><button class="icon" data-inrm title="Zeile löschen">✕</button></td></tr>`;

  function readTable(root) {
    return $$('[data-intable] tbody tr', root).map((tr) => {
      const g = (k) => $(`[data-k=${k}]`, tr);
      return { ch: +g('ch').value || 0, source: g('source').value.trim(), mic: g('mic').value.trim(), stand: g('stand').value.trim(), phantom: g('phantom').checked, note: g('note').value.trim() };
    }).filter((r) => r.ch && (r.source || r.mic));
  }

  async function pasteDialog(title = 'Liste einfügen') {
    return modal(`
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <p class="small muted">Inputliste aus E-Mail, Excel oder PDF kopieren und hier einfügen – eine Zeile pro Kanal, z. B. „1 Kick In Beta 91“.</p>
      <textarea rows="12" class="mono" placeholder="1  Kick In   Beta 91&#10;2  Kick Out  D112&#10;3  Snare     SM57 …" autofocus></textarea>
      <div class="actions"><button class="ghost" data-close>Abbrechen</button><button class="primary" data-ok>Übernehmen</button></div>`,
    (el, done) => { $('[data-ok]', el).onclick = () => done($('textarea', el).value); });
  }

  function bindOverview(b, docs) {
    const root = app();
    const save = async (rows, edited = true) => {
      const inp = rowsOf(b, docs);
      b.inputList = edited ? { rows: rows.sort((x, y) => x.ch - y.ch), sourceDocId: inp.source?.id || b.inputList?.sourceDocId || null, edited: true, savedAt: nowIso() } : null;
      await DB.put('bands', b);
    };
    const ed = $('[data-inedit]', root);
    if (ed) ed.onclick = () => { editing = b.id; render(); };
    $$('[data-reparse]', root).forEach((x) => (x.onclick = async () => {
      if (b.inputList?.edited && !(await confirmDialog('Inputliste neu aus dem aktuellen Rider einlesen? Deine Änderungen gehen verloren.', 'Neu einlesen'))) return;
      await save(null, false);
      toast('Neu eingelesen');
      render();
    }));
    const tbody = $('[data-intable] tbody', root);
    if (!tbody) return;
    const bindRm = () => $$('[data-inrm]', tbody).forEach((x) => (x.onclick = () => x.closest('tr').remove()));
    bindRm();
    $('[data-inadd]', root).onclick = () => {
      const max = Math.max(0, ...readTable(root).map((r) => r.ch), ...$$('[data-k=ch]', tbody).map((i) => +i.value || 0));
      tbody.insertAdjacentHTML('beforeend', editRow({ ch: max + 1, source: '', mic: '', stand: '', phantom: false, note: '' }));
      bindRm();
      $('tr:last-child [data-k=source]', tbody).focus();
    };
    $('[data-inpaste]', root).onclick = async () => {
      const txt = await pasteDialog();
      if (!txt) return;
      let rows = Patch.parseInputList(txt).rows;
      if (!rows.length) {
        // ohne Nummern: Zeilen der Reihe nach durchnummerieren
        rows = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => {
          const r = Patch.parseInputList(`${i + 1} ${l}\n${i + 2} x\n${i + 3} x`).rows[0];
          return r || { ch: i + 1, source: l, mic: '', stand: '', phantom: false, note: '' };
        });
      }
      tbody.innerHTML = rows.map(editRow).join('');
      bindRm();
      toast(`${rows.length} Kanäle übernommen – prüfen und speichern`);
    };
    $('[data-incancel]', root).onclick = () => { editing = null; render(); };
    $('[data-insave]', root).onclick = async () => {
      const rows = readTable(root);
      const dup = rows.map((r) => r.ch).find((c, i, a) => a.indexOf(c) !== i);
      if (dup) { toast(`Kanal ${dup} ist doppelt`); return; }
      await save(rows);
      editing = null;
      toast('Inputliste gespeichert');
      render();
    };
  }

  /* ---------- Bereich „Patch“ ---------- */
  async function patchTab(b, docs, profileId) {
    const profiles = (await DB.all('profiles')).sort(byName);
    const inp = rowsOf(b, docs);
    const pid = profiles.find((p) => p.id === profileId)?.id || profiles.find((p) => p.id === localStorage.getItem('patch.lastProfile'))?.id || profiles[0]?.id;
    const profile = profiles.find((p) => p.id === pid);
    if (!profiles.length) {
      return `<div class="empty"><p><b>Noch kein Stagebox-Profil.</b></p><p class="muted">Leg einmal an, auf welchem Stagebox-Kanal du was haben willst – dann erzeugt die App für jede Band den Patch.</p>
        <button class="primary" data-newprofile>+ Stagebox-Profil anlegen</button></div>`;
    }
    if (!inp.rows.length) {
      return `<div class="empty"><p><b>Keine Inputliste gefunden.</b></p><p class="muted">Lege die Inputliste der Band im Bereich „Überblick“ an (oder füge sie dort ein).</p>
        <a class="button primary" href="#/band/${b.id}">Zum Überblick</a></div>`;
    }
    localStorage.setItem('patch.lastProfile', pid);
    const ov = b.patchOverrides?.[pid] || {};
    const res = Patch.generate(inp.rows, profile, ov);
    const used = res.slots.filter((s) => s.input).length + res.overflow.length;
    const count = (h) => res.slots.filter((s) => s.how === h).length;
    const options = (sel) => `<option value="">— frei —</option>${inp.rows.map((r) => `<option value="${r.ch}" ${sel === r.ch ? 'selected' : ''}>${r.ch} · ${esc(r.source)}</option>`).join('')}`;
    const line = (s, over = false) => {
      const r = s.input?.r;
      const [icon, cls, title] = HOW[s.how] || ['', '', ''];
      if (hideEmpty && !r) return '';
      return `<tr class="${r ? 'fam-' + norm(s.input.k.fam) : 'empty-row'} ${over ? 'over' : ''}">
        <td class="ch">${s.ch}</td>
        <td class="mine">${esc(s.label) || '<span class="muted">–</span>'}</td>
        <td class="how"><span class="how-${cls}" title="${esc(title)}">${icon}</span></td>
        <td class="band-ch no-print">${over ? `<b>${r.ch}</b>` : `<select data-ov="${s.ch}" aria-label="Band-Kanal für Stagebox ${s.ch}">${options(r?.ch)}</select>`}</td>
        <td class="print-only">${r ? r.ch : ''}</td>
        <td><b>${r ? esc(r.source) : ''}</b></td>
        <td>${r ? esc(r.mic) : ''}</td>
        <td>${r ? esc(r.stand) : ''}</td>
        <td>${r?.phantom ? '●' : ''}</td>
        <td class="small">${r ? esc(r.note) : esc(s.note || '')}</td>
      </tr>`;
    };
    return `
      <div class="patch-head no-print">
        <label class="lbl">Stagebox-Profil
          <select data-profile>${profiles.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} (${p.channels.length} Kanäle)</option>`).join('')}<option value="__new">+ Neues Profil …</option></select></label>
        <a class="small" href="#/stagebox/${pid}">Profil bearbeiten</a>
      </div>
      <div class="print-only print-title"><h2>Patch: ${esc(b.name)}</h2><p>Stagebox-Profil: ${esc(profile.name)} · Stand Inputliste: ${inp.source?.date ? fmtDate(inp.source.date) : '–'} · erstellt ${fmtDate(today())}</p></div>
      <p class="small patch-sum">${used} von ${inp.rows.filter((r) => !['spare', 'empty'].includes(Patch.classify(r.source).cls)).length} Band-Kanälen gepatcht ·
        <span class="how-ok">✓ ${count('exact') + count('class')} passend</span> ·
        <span class="how-similar">≈ ${count('similar') + count('family')} ähnlich</span> ·
        <span class="how-free">＋ ${count('free')} auf freie Kanäle</span>
        ${count('manual') ? ` · <span class="how-manual">✎ ${count('manual')} manuell</span>` : ''}
        ${res.overflow.length ? ` · <span class="warn-text">! ${res.overflow.length} passen nicht mehr in die Stagebox</span>` : ''}</p>
      <div class="table-wrap"><table class="ptable patch">
        <thead><tr><th>Stagebox</th><th>Dein Profil</th><th></th><th class="no-print">← Band-Kanal</th><th class="print-only">Band</th><th>Quelle</th><th>Mikro / DI</th><th>Stativ</th><th>48V</th><th>Notiz</th></tr></thead>
        <tbody>${res.slots.map((s) => line(s)).join('')}${res.overflow.map((s) => line(s, true)).join('')}</tbody>
      </table></div>
      <div class="actions left no-print">
        <label class="check small"><input type="checkbox" data-hideempty ${hideEmpty ? 'checked' : ''}> leere Kanäle ausblenden</label>
        <span class="grow"></span>
        ${Object.keys(ov).length ? '<button class="ghost small-btn" data-ovreset>Manuelle Zuordnung zurücksetzen</button>' : ''}
        <button class="ghost small-btn" data-copy>📋 Kopieren</button>
        <button class="ghost small-btn" data-csv>⬇︎ CSV</button>
        <button class="primary small-btn" data-print>🖨 Drucken / PDF</button>
      </div>
      <p class="muted small no-print">Die Zuordnung erfolgt über die Instrument-Bezeichnungen. Über „← Band-Kanal“ kannst du jede Zeile selbst ändern – das wird für diese Band und dieses Profil gespeichert.</p>`;
  }

  async function exportRows(b, docs, pid) {
    const profile = await DB.get('profiles', pid);
    const inp = rowsOf(b, docs);
    const res = Patch.generate(inp.rows, profile, b.patchOverrides?.[pid] || {});
    const head = ['Stagebox', 'Profil', 'Band-Kanal', 'Quelle', 'Mikro/DI', 'Stativ', '48V', 'Notiz'];
    const rows = [...res.slots, ...res.overflow].filter((s) => s.input || !hideEmpty).map((s) => {
      const r = s.input?.r;
      return [s.ch, s.label, r?.ch ?? '', r?.source ?? '', r?.mic ?? '', r?.stand ?? '', r?.phantom ? '48V' : '', r?.note ?? ''];
    });
    return [head, ...rows];
  }

  function bindPatch(b, docs) {
    const root = app();
    const np = $('[data-newprofile]', root);
    if (np) np.onclick = async () => { const p = await profileDialog(); if (p) location.hash = `#/band/${b.id}/patch/${p.id}`; };
    const sel = $('[data-profile]', root);
    if (!sel) return;
    const pid = sel.value;
    sel.onchange = async () => {
      if (sel.value === '__new') { const p = await profileDialog(); location.hash = p ? `#/band/${b.id}/patch/${p.id}` : location.hash; if (!p) render(); return; }
      location.hash = `#/band/${b.id}/patch/${sel.value}`;
    };
    $$('[data-ov]', root).forEach((s) => (s.onchange = async () => {
      b.patchOverrides ||= {};
      const ov = (b.patchOverrides[pid] ||= {});
      const v = +s.value || 0;
      if (v) for (const k of Object.keys(ov)) if (ov[k] === v) delete ov[k];
      ov[s.dataset.ov] = v;
      await DB.put('bands', b);
      render();
    }));
    const rs = $('[data-ovreset]', root);
    if (rs) rs.onclick = async () => { delete b.patchOverrides[pid]; await DB.put('bands', b); render(); };
    $('[data-hideempty]', root).onchange = (e) => { hideEmpty = e.target.checked; localStorage.setItem('patch.hideEmpty', hideEmpty ? '1' : ''); render(); };
    $('[data-copy]', root).onclick = async () => {
      const rows = await exportRows(b, docs, pid);
      const txt = rows.map((r) => r.join('\t')).join('\n');
      try { await navigator.clipboard.writeText(txt); toast('Kopiert – z. B. in Excel oder eine Mail einfügen'); } catch { modal(`<h2>Patch</h2><textarea rows="14" class="mono">${esc(txt)}</textarea><div class="actions"><button class="primary" data-close>OK</button></div>`); }
    };
    $('[data-csv]', root).onclick = async () => {
      const rows = await exportRows(b, docs, pid);
      const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `Patch_${b.name.replace(/[^\w-]+/g, '_')}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    $('[data-print]', root).onclick = () => window.print();
  }

  /* ---------- Stagebox-Profile ---------- */
  async function profileDialog() {
    const bands = (await Data.bands()).sort(byName);
    const docs = await Data.docs();
    const withList = bands.filter((b) => rowsOf(b, docs.filter((d) => d.bandId === b.id)).rows.length);
    const res = await modal(`
      <div class="modal-head"><h2>Neues Stagebox-Profil</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <label>Name <input name="name" required placeholder="z. B. Meine 32er Stagebox / Club XY" autofocus></label>
        <label>Start mit
          <select name="tpl">
            <option value="std">Vorlage: Standard-Rockband, 32 Kanäle</option>
            <option value="empty">Leer</option>
            ${withList.map((b) => `<option value="band:${b.id}">Inputliste von ${esc(b.name)}</option>`).join('')}
            <option value="paste">Liste einfügen …</option>
          </select></label>
        <label class="n-wrap">Anzahl Kanäle <input name="n" type="number" min="1" max="128" value="32"></label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Anlegen</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      const upd = () => ($('.n-wrap', el).hidden = f.tpl.value !== 'empty');
      f.tpl.onchange = upd; upd();
      f.onsubmit = (e) => { e.preventDefault(); done({ name: f.name.value.trim() || 'Stagebox', tpl: f.tpl.value, n: Math.min(128, Math.max(1, +f.n.value || 32)) }); };
    });
    if (!res) return null;
    let labels = Patch.TEMPLATE_32;
    if (res.tpl === 'empty') labels = Array(res.n).fill('');
    if (res.tpl.startsWith('band:')) {
      const b = bands.find((x) => x.id === res.tpl.slice(5));
      const rows = rowsOf(b, docs.filter((d) => d.bandId === b.id)).rows;
      labels = [];
      for (const r of rows) labels[r.ch - 1] = r.source;
      labels = Array.from(labels, (l) => l || '');
    }
    if (res.tpl === 'paste') {
      const txt = await pasteDialog('Stagebox-Belegung einfügen');
      if (!txt) return null;
      const rows = Patch.parseInputList(txt).rows;
      labels = [];
      if (rows.length) for (const r of rows) labels[r.ch - 1] = r.source;
      else labels = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      labels = Array.from(labels, (l) => l || '');
    }
    const p = Patch.newProfile(res.name, labels);
    await DB.put('profiles', p);
    toast('Profil angelegt');
    return p;
  }

  async function viewStagebox() {
    setTab('stagebox');
    const profiles = (await DB.all('profiles')).sort(byName);
    app().innerHTML = `
      <div class="page-head"><h1>Stagebox-Profile</h1><button class="primary" data-new>+ Profil</button></div>
      <p class="muted small">Hier legst du fest, auf welchem Kanal deiner Stagebox du was haben willst. Bei jeder Band kannst du daraus den Patch erzeugen: welcher Kanal aus ihrem Rack/Split auf welchen Stagebox-Kanal kommt.</p>
      <div class="list">${profiles.map((p) => {
        const used = p.channels.filter((c) => c.label && !['spare', 'empty'].includes(Patch.classify(c.label).cls)).length;
        return `<a class="card row-card" href="#/stagebox/${p.id}"><div class="avatar">🎛</div><span class="grow"><b>${esc(p.name)}</b><br>
          <span class="muted small">${p.channels.length} Kanäle · ${used} belegt${p.notes ? ' · ' + esc(p.notes.slice(0, 60)) : ''}</span></span></a>`;
      }).join('') || '<div class="empty"><p class="muted">Noch kein Profil. Starte mit der Standard-Vorlage und passe sie an.</p></div>'}</div>`;
    $('[data-new]').onclick = async () => { const p = await profileDialog(); if (p) location.hash = '#/stagebox/' + p.id; };
  }

  async function viewProfile(id) {
    setTab('stagebox');
    const p = await DB.get('profiles', id);
    if (!p) { app().innerHTML = '<p>Profil nicht gefunden. <a href="#/stagebox">Zurück</a></p>'; return; }
    const row = (c) => {
      const k = Patch.classify(c.label);
      return `<tr class="${c.label ? 'fam-' + norm(k.fam) : 'empty-row'}">
        <td class="ch">${c.ch}</td>
        <td><input value="${esc(c.label)}" data-l="${c.ch}" placeholder="frei"></td>
        <td class="small muted kind">${c.label ? esc(k.fam === 'Frei' ? 'frei' : k.fam) : ''}</td>
        <td><input value="${esc(c.note)}" data-n="${c.ch}" placeholder="z. B. Gate, Insert"></td></tr>`;
    };
    app().innerHTML = `
      <a class="back" href="#/stagebox">‹ Stagebox-Profile</a>
      <div class="page-head">
        <div class="grow"><input class="title-in" value="${esc(p.name)}" data-name aria-label="Name des Profils"></div>
        <div class="head-actions"><button class="ghost" data-dup>Duplizieren</button><button class="ghost danger-text" data-del>Löschen</button></div>
      </div>
      <textarea class="notes-in" rows="2" data-notes placeholder="Notizen, z. B. Stagebox A = 1–16, B = 17–32, Pult …">${esc(p.notes)}</textarea>
      <div class="table-wrap"><table class="ptable edit profile">
        <thead><tr><th>Kanal</th><th>Was soll hier liegen?</th><th>erkannt als</th><th>Notiz</th></tr></thead>
        <tbody>${p.channels.map(row).join('')}</tbody></table></div>
      <div class="actions left">
        <button class="ghost small-btn" data-add8>+ 8 Kanäle</button>
        <button class="ghost small-btn" data-rm1 ${p.channels.length <= 1 ? 'disabled' : ''}>− letzten Kanal</button>
        <button class="ghost small-btn" data-paste>📋 Liste einfügen</button>
      </div>
      <p class="muted small">Wird automatisch gespeichert. Tipp: Bezeichnungen wie „Kick In“, „OH L“, „Vox Lead“, „Keys R“ oder „Spare“ werden beim Patchen erkannt.</p>`;

    let timer = null;
    const save = () => { clearTimeout(timer); timer = setTimeout(() => DB.put('profiles', p), 400); };
    $('[data-name]').oninput = (e) => { p.name = e.target.value.trim() || 'Stagebox'; save(); };
    $('[data-notes]').oninput = (e) => { p.notes = e.target.value; save(); };
    $$('[data-l]').forEach((i) => (i.oninput = () => {
      const c = p.channels.find((x) => x.ch === +i.dataset.l);
      c.label = i.value;
      const k = Patch.classify(c.label);
      i.closest('tr').querySelector('.kind').textContent = c.label ? (k.fam === 'Frei' ? 'frei' : k.fam) : '';
      i.closest('tr').className = c.label ? 'fam-' + norm(k.fam) : 'empty-row';
      save();
    }));
    $$('[data-n]').forEach((i) => (i.oninput = () => { p.channels.find((x) => x.ch === +i.dataset.n).note = i.value; save(); }));
    $('[data-add8]').onclick = async () => {
      const n = p.channels.length;
      for (let i = 1; i <= 8; i++) p.channels.push({ ch: n + i, label: '', note: '' });
      await DB.put('profiles', p); render();
    };
    $('[data-rm1]').onclick = async () => { p.channels.pop(); await DB.put('profiles', p); render(); };
    $('[data-paste]').onclick = async () => {
      const txt = await pasteDialog('Stagebox-Belegung einfügen');
      if (!txt) return;
      const rows = Patch.parseInputList(txt).rows;
      let labels = [];
      if (rows.length) for (const r of rows) labels[r.ch - 1] = r.source;
      else labels = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      labels = Array.from(labels, (l) => l || '');
      p.channels = labels.map((label, i) => ({ ch: i + 1, label, note: p.channels[i]?.note || '' }));
      await DB.put('profiles', p);
      toast(`${labels.length} Kanäle übernommen`);
      render();
    };
    $('[data-dup]').onclick = async () => {
      const c = { ...structuredClone(p), id: uid(), name: p.name + ' (Kopie)', createdAt: nowIso() };
      await DB.put('profiles', c);
      location.hash = '#/stagebox/' + c.id;
    };
    $('[data-del]').onclick = async () => {
      if (await confirmDialog(`Profil „${esc(p.name)}“ löschen?`, 'Löschen', true)) { await DB.del('profiles', p.id); location.hash = '#/stagebox'; }
    };
  }

  return { overview, bindOverview, patchTab, bindPatch, viewStagebox, viewProfile, profileDialog };
})();
