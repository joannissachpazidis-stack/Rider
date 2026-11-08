'use strict';
/* ======================================================================
   Festivals: mehrere Tage, optional mehrere Bühnen.
   Intern ist jeder Tag × Bühne ein normales Konzert (festivalId → Festival),
   damit Line-up, Tagesablauf, Rider, Patchlisten und Drucken überall gleich funktionieren.
   Das Festival selbst hat ein eigenes Line-up: Bands, die noch keinem Tag zugeteilt sind.
   ====================================================================== */
const Festival = (() => {
  const isFestival = (c) => c?.kind === 'festival';
  const dayTitle = (f, d) => `${f.title} – ${d.dayLabel || 'Tag'}${d.stage ? ' · ' + d.stage : ''}`;
  const shortDate = (iso) => (iso ? toDate(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'ohne Datum');
  const plusDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const stageRank = (f, s) => { const i = (f.stages || []).indexOf(s); return i < 0 ? 999 : i; };

  const daysOf = (f, concerts) => concerts.filter((c) => c.festivalId === f.id)
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || stageRank(f, a.stage) - stageRank(f, b.stage) || (a.stage || '').localeCompare(b.stage || ''));
  // Tag = gleiches Datum (ohne Datum: gleiche Bezeichnung); darin die Bühnen
  const groupKey = (d) => d.date || 'L:' + (d.dayLabel || '');
  function groups(days) {
    const m = new Map();
    for (const d of days) { const k = groupKey(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d); }
    return [...m.values()];
  }
  const stagesOf = (days) => [...new Set(days.map((d) => d.stage).filter(Boolean))];
  const countLabel = (days) => {
    const g = groups(days).length, s = stagesOf(days).length;
    return `${g} ${g === 1 ? 'Tag' : 'Tage'}${s > 1 ? ` · ${s} Bühnen` : ''}`;
  };
  const range = (days) => {
    const ds = days.map((d) => d.date).filter(Boolean).sort();
    if (!ds.length) return '';
    if (ds[0] === ds[ds.length - 1]) return fmtDate(ds[0]);
    const a = toDate(ds[0]), b = toDate(ds[ds.length - 1]);
    return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `${String(a.getDate()).padStart(2, '0')}.–${fmtDate(ds[ds.length - 1])}` : `${fmtDate(ds[0])} – ${fmtDate(ds[ds.length - 1])}`;
  };
  const dayName = (d) => `${d.dayLabel || 'Tag'}${d.stage ? ' · ' + d.stage : ''}`;

  async function syncDays(f) {
    for (const d of daysOf(f, await Data.concerts())) {
      const t = dayTitle(f, d);
      if (d.title !== t || d.venue !== f.venue) { d.title = t; d.venue = f.venue; await DB.put('concerts', d); }
    }
  }
  async function newDay(f, fields) {
    const d = { id: uid(), festivalId: f.id, dayLabel: 'Tag', stage: '', date: '', time: '', notes: '', lineup: [], profileId: f.profileId || null, createdAt: nowIso(), ...fields, venue: f.venue };
    d.title = dayTitle(f, d);
    await DB.put('concerts', d);
    return d;
  }

  /* ---------- Anlegen / Bearbeiten ---------- */
  async function createDialog() {
    const bands = (await Data.bands()).sort(byName);
    const res = await modal(`
      <div class="modal-head"><h2>🎪 Neues Festival</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form" novalidate>
        <label>Name <input name="title" required placeholder="z. B. Rock am See 2027" autofocus></label>
        <label>Ort <input name="venue" placeholder="Gelände, Stadt"></label>
        ${Share.picker()}
        <div class="row2">
          <label>Erster Tag <input type="date" name="date" value="${today()}"></label>
          <label>Anzahl Tage <input type="number" name="n" min="1" max="14" value="3"></label>
        </div>
        <label>Bühnen <span class="muted small">(optional, mit Komma getrennt)</span>
          <input name="stages" placeholder="z. B. Hauptbühne, Zeltbühne"></label>
        <label>Bands <span class="muted small">(optional – Tage und Reihenfolge kannst du später zuteilen)</span>
          <textarea name="bands" rows="2" placeholder="Eine Band pro Zeile oder mit Komma getrennt"></textarea></label>
        <datalist id="dl-fb">${bands.map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
        <label>Notizen <textarea name="notes" rows="2" placeholder="Produktion, Ansprechpartner, Anfahrt …"></textarea></label>
        <p class="error" hidden></p>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Anlegen</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      Share.bindPicker(el);
      f.onsubmit = (e) => {
        e.preventDefault();
        const title = f.elements.namedItem('title').value.trim();
        if (!title) { const er = $('.error', el); er.textContent = 'Bitte einen Namen angeben.'; er.hidden = false; return; }
        done({ title, venue: f.venue.value.trim(), date: f.date.value || today(), n: Math.min(14, Math.max(1, +f.n.value || 1)),
          stages: f.stages.value.split(',').map((s) => s.trim()).filter(Boolean), bands: f.bands.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean), notes: f.notes.value.trim(), sharedWith: Share.read(el) ?? Share.defaults() });
      };
    });
    if (!res) return;
    const fest = { id: uid(), kind: 'festival', title: res.title, venue: res.venue, notes: res.notes, stages: res.stages, sharedWith: res.sharedWith, lineup: [], createdAt: nowIso() };
    Share.remember(res.sharedWith);
    for (const name of res.bands) {
      const { band } = await Data.findOrCreateBand(name);
      if (!fest.lineup.some((e) => e.bandId === band.id)) fest.lineup.push({ bandId: band.id, time: '', docIds: [], unplaced: true });
    }
    await DB.put('concerts', fest);
    for (let i = 0; i < res.n; i++) for (const stage of res.stages.length ? res.stages : ['']) await newDay(fest, { dayLabel: `Tag ${i + 1}`, stage, date: plusDays(res.date, i) });
    location.hash = '#/concert/' + fest.id;
    await render();
    for (const e of [...fest.lineup]) await riderCheck(e.bandId, fest.id);
    render();
  }

  async function editDialog(f) {
    const res = await modal(`
      <div class="modal-head"><h2>Festival bearbeiten</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <label>Name <input name="title" required value="${esc(f.title)}"></label>
        <label>Ort <input name="venue" value="${esc(f.venue || '')}"></label>
        ${Share.picker(f)}
        <label>Notizen <textarea name="notes" rows="3">${esc(f.notes || '')}</textarea></label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      const fm = $('form', el);
      Share.bindPicker(el);
      fm.onsubmit = (e) => {
        e.preventDefault();
        const share = Share.read(el);
        done({ title: fm.elements.namedItem('title').value.trim() || f.title, venue: fm.venue.value.trim(), notes: fm.notes.value.trim(), ...(share ? { sharedWith: share } : {}) });
      };
    });
    if (!res) return;
    const shareChanged = res.sharedWith && JSON.stringify(res.sharedWith) !== JSON.stringify(f.sharedWith || []);
    Object.assign(f, res);
    await DB.put('concerts', f);
    await syncDays(f);
    // Tage übernehmen die Freigabe des Festivals → neu hochladen
    if (shareChanged) for (const d of daysOf(f, await Data.concerts())) await DB.put('concerts', d);
    render();
  }

  // Neuen Tag (mit allen Bühnen) anlegen
  async function addDayDialog(f) {
    const days = daysOf(f, await Data.concerts());
    const gs = groups(days);
    const last = days.filter((d) => d.date).pop();
    const res = await modal(`
      <div class="modal-head"><h2>Tag hinzufügen</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <div class="row2">
          <label>Bezeichnung <input name="label" value="Tag ${gs.length + 1}" placeholder="z. B. Tag 4 oder Sonntag"></label>
          <label>Datum <input type="date" name="date" value="${last?.date ? plusDays(last.date, 1) : today()}"></label>
        </div>
        <label>Bühnen <span class="muted small">(mit Komma getrennt, leer = ohne Bühne)</span><input name="stages" value="${esc(stagesOf(days).join(', '))}"></label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Hinzufügen</button></div>
      </form>`, (el, done) => {
      const fm = $('form', el);
      fm.onsubmit = (e) => { e.preventDefault(); done({ label: fm.label.value.trim() || `Tag ${gs.length + 1}`, date: fm.date.value, stages: fm.stages.value.split(',').map((s) => s.trim()).filter(Boolean) }); };
    });
    if (!res) return;
    let first = null;
    for (const stage of res.stages.length ? res.stages : ['']) { const d = await newDay(f, { dayLabel: res.label, date: res.date, stage }); first ||= d; }
    for (const s of res.stages) if (!(f.stages || []).includes(s)) (f.stages ||= []).push(s);
    await DB.put('concerts', f);
    location.hash = `#/concert/${f.id}/${first.id}`;
  }

  // Bühne zu einem Tag (oder allen Tagen) hinzufügen
  async function addStageDialog(f, day) {
    const days = daysOf(f, await Data.concerts());
    const res = await modal(`
      <div class="modal-head"><h2>Bühne hinzufügen</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <label>Name der Bühne <input name="stage" required placeholder="z. B. Zeltbühne" autofocus></label>
        ${!day.stage ? '<label>Name der bisherigen Bühne <input name="old" placeholder="z. B. Hauptbühne"></label>' : ''}
        <label class="check"><input type="checkbox" name="all" checked> an allen ${groups(days).length} Tagen hinzufügen</label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Hinzufügen</button></div>
      </form>`, (el, done) => {
      const fm = $('form', el);
      fm.onsubmit = (e) => { e.preventDefault(); if (!fm.stage.value.trim()) return; done({ stage: fm.stage.value.trim(), old: fm.old?.value.trim() || '', all: fm.all.checked }); };
    });
    if (!res) return;
    f.stages ||= [];
    // Bisher ohne Bühne? Dann bekommt die bestehende Bühne einen Namen
    if (res.old) {
      for (const d of days.filter((x) => !x.stage)) { d.stage = res.old; d.title = dayTitle(f, d); await DB.put('concerts', d); }
      if (!f.stages.includes(res.old)) f.stages.push(res.old);
    }
    if (!f.stages.includes(res.stage)) f.stages.push(res.stage);
    await DB.put('concerts', f);
    let created = null;
    for (const g of res.all ? groups(days) : [groups(days).find((g) => g.includes(days.find((x) => x.id === day.id)))]) {
      if (g.some((x) => x.stage === res.stage)) continue;
      const d = await newDay(f, { dayLabel: g[0].dayLabel, date: g[0].date, stage: res.stage });
      if (g.some((x) => x.id === day.id)) created = d;
    }
    location.hash = `#/concert/${f.id}/${(created || day).id}`;
    render();
  }

  // Tag/Bühne bearbeiten: Bezeichnung und Datum gelten für alle Bühnen des Tages
  async function dayDialog(f, day) {
    const days = daysOf(f, await Data.concerts());
    const siblings = groups(days).find((g) => g.some((x) => x.id === day.id)) || [day];
    const multi = siblings.length > 1;
    const res = await modal(`
      <div class="modal-head"><h2>${multi ? 'Tag / Bühne bearbeiten' : 'Tag bearbeiten'}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <div class="row2">
          <label>Bezeichnung <input name="label" value="${esc(day.dayLabel || '')}" placeholder="z. B. Tag 2 oder Freitag"></label>
          <label>Datum <input type="date" name="date" value="${esc(day.date || '')}"></label>
        </div>
        ${multi ? '<p class="small muted">Bezeichnung und Datum gelten für alle Bühnen dieses Tages.</p>' : ''}
        <div class="row2">
          <label>Bühne <input name="stage" value="${esc(day.stage || '')}" placeholder="optional"></label>
          <label>Beginn <input type="time" name="time" value="${esc(day.time || '')}"></label>
        </div>
        <label>Notizen <textarea name="notes" rows="2">${esc(day.notes || '')}</textarea></label>
        <div class="actions"><button type="button" class="ghost danger-text" data-del>${multi ? 'Diese Bühne löschen' : 'Tag löschen'}</button><span class="grow"></span>
          <button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      const fm = $('form', el);
      $('[data-del]', el).onclick = () => done('delete');
      fm.onsubmit = (e) => { e.preventDefault(); done({ dayLabel: fm.label.value.trim() || 'Tag', date: fm.date.value, stage: fm.stage.value.trim(), time: fm.time.value, notes: fm.notes.value.trim() }); };
    });
    if (!res) return;
    if (res === 'delete') {
      const n = day.lineup.length;
      if (!(await confirmDialog(`„${esc(dayName(day))}“ löschen?${n ? ` Die ${n} Band${n > 1 ? 's' : ''} kommen zurück zu „Noch ohne Tag“.` : ''} Die Rider bleiben bei den Bands.`, 'Löschen', true))) return;
      for (const e of day.lineup) if (!f.lineup.some((x) => x.bandId === e.bandId)) f.lineup.push({ ...e, time: '', unplaced: true });
      await DB.put('concerts', f);
      await DB.del('concerts', day.id);
      location.hash = '#/concert/' + f.id;
      return;
    }
    for (const s of siblings) {
      s.dayLabel = res.dayLabel; s.date = res.date;
      if (s.id === day.id) Object.assign(s, { stage: res.stage, time: res.time, notes: res.notes });
      s.title = dayTitle(f, s);
      await DB.put('concerts', s);
    }
    if (res.stage && !(f.stages || []).includes(res.stage)) { (f.stages ||= []).push(res.stage); await DB.put('concerts', f); }
    render();
  }

  async function remove(f) {
    const days = daysOf(f, await Data.concerts());
    if (!(await confirmDialog(`Festival „${esc(f.title)}“ (${countLabel(days)}) löschen? Die Rider bleiben bei den Bands gespeichert.`, 'Löschen', true))) return;
    for (const d of days) await DB.del('concerts', d.id);
    await DB.del('concerts', f.id);
    location.hash = '#/concerts';
  }

  /* ---------- Bands zwischen Tagen / „ohne Tag“ verschieben ---------- */
  function moveOptions(fest, currentId) {
    const opts = [];
    if (currentId !== fest.f.id) opts.push(`<option value="${fest.f.id}">↩ Noch ohne Tag</option>`);
    for (const g of groups(fest.days)) for (const d of g) if (d.id !== currentId) opts.push(`<option value="${d.id}">${esc(dayName(d))} · ${shortDate(d.date)}</option>`);
    return opts.join('');
  }

  async function moveBand(fromId, bandId, toId) {
    const from = await DB.get('concerts', fromId), to = await DB.get('concerts', toId);
    if (!from || !to) return;
    const e = from.lineup.find((x) => x.bandId === bandId);
    if (!e) return;
    from.lineup = from.lineup.filter((x) => x.bandId !== bandId);
    const removed = (from.schedule || []).filter((x) => x.bandId === bandId).length;
    if (removed) from.schedule = from.schedule.filter((x) => x.bandId !== bandId);
    await DB.put('concerts', from);
    if (!to.lineup.some((x) => x.bandId === bandId)) to.lineup.push({ ...e, time: '', unplaced: true });
    await DB.put('concerts', to);
    const name = (await DB.get('bands', bandId))?.name || 'Band';
    toast(`${name} → ${to.kind === 'festival' ? 'noch ohne Tag' : dayName(to)}${removed ? ` (${removed} Ablauf-Punkt${removed > 1 ? 'e' : ''} entfernt)` : ''}`);
    render();
  }

  /* ---------- Seite ---------- */
  async function prepare(f, sub) {
    const days = daysOf(f, await Data.concerts());
    let day = null;
    if (sub && sub !== 'uebersicht') day = days.find((d) => d.id === sub) || null;
    else if (!sub) day = days.find((d) => d.date === today()) || null; // am Festivaltag direkt den heutigen Tag zeigen
    return { f, days, day };
  }

  function head(fest) {
    const { f, days, day } = fest;
    const gs = groups(days);
    const tab = (g) => {
      const active = day && g.some((x) => x.id === day.id);
      return `<a href="#/concert/${f.id}/${g[0].id}" class="${active ? 'active' : ''}">${esc(g[0].dayLabel || 'Tag')}<small>${shortDate(g[0].date)}${g[0].date === today() ? ' · heute' : ''}${g.length > 1 ? ` · ${g.length} Bühnen` : ''}</small></a>`;
    };
    return `
      <a class="back no-print" href="#/concerts">‹ Konzerte</a>
      <div class="page-head">
        <div><span class="badge fest">🎪 Festival</span>${Share.badge(f)}<h1>${esc(f.title)}</h1>
          <div class="muted">${[range(days), countLabel(days), f.venue && esc(f.venue)].filter(Boolean).join(' · ')}</div></div>
        <div class="head-actions"><button class="ghost" data-fedit>Bearbeiten</button><button class="ghost danger-text" data-fdel>Löschen</button></div>
      </div>
      <nav class="subtabs day-tabs no-print">
        <a href="#/concert/${f.id}/uebersicht" class="${day ? '' : 'active'}">Übersicht<small>${countLabel(days)}${f.lineup.length ? ` · ${f.lineup.length} ohne Tag` : ''}</small></a>
        ${gs.map(tab).join('')}
        <a href="#" data-fadd class="add-day">＋ Tag<small>hinzufügen</small></a>
      </nav>`;
  }

  function bindHead(fest) {
    $('[data-fedit]').onclick = () => editDialog(fest.f);
    $('[data-fdel]').onclick = () => remove(fest.f);
    $('[data-fadd]').onclick = (e) => { e.preventDefault(); addDayDialog(fest.f); };
    const st = $('[data-fstage]');
    if (st) st.onclick = () => addStageDialog(fest.f, fest.day);
  }

  // Kopf eines Tages (ersetzt den normalen Konzertkopf), mit Bühnen-Umschalter
  function dayHead(fest) {
    const d = fest.day;
    const siblings = groups(fest.days).find((g) => g.some((x) => x.id === d.id)) || [d];
    const rel = relDay(d.date);
    return `
      ${siblings.length > 1 || d.stage ? `<div class="stage-pills no-print">${siblings.map((s) => `<a href="#/concert/${fest.f.id}/${s.id}" class="${s.id === d.id ? 'active' : ''}">🎚 ${esc(s.stage || 'ohne Bühne')}<small>${s.lineup.length} Band${s.lineup.length === 1 ? '' : 's'}</small></a>`).join('')}
        <button class="ghost small-btn" data-fstage>＋ Bühne</button></div>` : ''}
      <div class="page-head day-head">
        <div><h2>${esc(d.dayLabel || 'Tag')}${d.stage ? ` · ${esc(d.stage)}` : ''}</h2>
          <div class="muted">${[d.date && fmtWeekday(d.date) + ', ' + fmtDate(d.date), d.time && d.time + ' Uhr'].filter(Boolean).join(' · ')}
            ${rel ? `<span class="badge ${rel === 'Heute' ? 'accent' : ''}">${rel}</span>` : ''}</div></div>
        <div class="head-actions">${siblings.length === 1 && !d.stage ? '<button class="ghost" data-fstage>＋ Bühne</button>' : ''}<button class="ghost" data-editc>Bearbeiten</button></div>
      </div>`;
  }

  async function overview(fest) {
    const { f, days } = fest;
    const [bands, docs, profiles] = await Promise.all([Data.bands(), Data.docs(), DB.all('profiles')]);
    profiles.sort(byName);
    const bandMap = new Map(bands.map((b) => [b.id, b]));
    const docMap = new Map(docs.map((d) => [d.id, d]));
    const gs = groups(days);
    // Druckseiten vorbereiten (Drucken muss sofort beim Antippen starten)
    const prints = new Map(days.map((d) => [d.id, PatchUI.concertSheets(d, profiles, bands, docs)]));
    const scheds = new Map(days.map((d) => [d.id, (d.schedule || []).length ? Schedule.sheet(d, bandMap) : '']));
    const gPrint = (g) => g.map((d) => prints.get(d.id).html).join('');
    const gSched = (g) => g.map((d) => scheds.get(d.id)).join('');
    const allHtml = gs.map(gPrint).join(''), allSched = gs.map(gSched).join('');
    const hasDocs = (e) => e.docIds.some((x) => docMap.has(x));
    const chips = (lineup) => orderedLineup({ lineup }).map((e) => `<span class="bchip ${hasDocs(e) ? 'ok' : 'missing'}">${esc(bandMap.get(e.bandId)?.name || '?')}${e.time ? ` <span class="muted">${esc(e.time)}</span>` : ''}</span>`).join('') || '<span class="muted small">noch keine Bands</span>';

    const dayCard = (g, gi) => `
      <div class="card fest-day">
        <div class="fest-day-top">
          <a class="fest-day-main" href="#/concert/${f.id}/${g[0].id}">
            <div class="date-box">${g[0].date ? `<span>${fmtWeekday(g[0].date)}</span><b>${toDate(g[0].date).getDate()}</b><span>${toDate(g[0].date).toLocaleDateString('de-DE', { month: 'short' })}</span>` : '<b>?</b>'}</div>
            <div class="grow"><div class="card-title">${esc(g[0].dayLabel || 'Tag')} ${g[0].date === today() ? '<span class="badge accent">Heute</span>' : ''}</div>
              <div class="muted small">${g.length > 1 ? `${g.length} Bühnen · ` : ''}${g.reduce((n, d) => n + d.lineup.length, 0)} Bands</div></div>
          </a>
          <div class="fest-day-actions no-print">
            ${gPrint(g) ? `<button class="ghost small-btn" data-pgroup="${gi}" title="Ablauf + Patchlisten ${g.length > 1 ? 'aller Bühnen ' : ''}dieses Tages">🖨 Tag drucken</button>` : ''}
            ${gSched(g) ? `<button class="ghost small-btn" data-pgsched="${gi}">🕒 Ablauf</button>` : ''}
          </div>
        </div>
        ${g.map((d) => `
          <div class="fest-stage">
            <a href="#/concert/${f.id}/${d.id}" class="fest-stage-name">${d.stage ? `🎚 ${esc(d.stage)}` : 'Line-up'}<span class="muted small">${[d.time && 'Beginn ' + d.time, Schedule.summary(d)].filter(Boolean).join(' · ')}</span></a>
            <div class="band-chips">${chips(d.lineup)}</div>
            ${g.length > 1 && prints.get(d.id).html ? `<button class="link small no-print" data-pday="${d.id}">🖨 nur ${esc(d.stage || 'diese Bühne')}</button>` : ''}
          </div>`).join('')}
      </div>`;

    const rows = days.flatMap((d) => d.lineup.map((e) => ({ d, e, b: bandMap.get(e.bandId) }))).filter((x) => x.b);
    const pool = f.lineup.map((e) => ({ e, b: bandMap.get(e.bandId) })).filter((x) => x.b);
    app().innerHTML = head(fest) + `
      ${f.notes ? `<div class="notes">${esc(f.notes)}</div>` : ''}
      <div class="concert-tools card">
        ${profiles.length ? `<label class="lbl">🎛 Stagebox für das Festival
          <select data-fprofile><option value="">– wählen –</option>${profiles.map((p) => `<option value="${p.id}" ${p.id === f.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <span class="small muted">gilt für alle Tage und Bühnen – einzeln änderbar</span></label>` : '<p class="small muted">Lege unter „Stagebox“ ein Profil an, um Patchlisten zu erzeugen.</p>'}
        <div class="printall-wrap">
          <button class="primary" data-pall ${allHtml ? '' : 'disabled'}>🖨 Ganzes Festival drucken</button>
          ${allSched ? '<button class="ghost small-btn" data-pallsched>🕒 Nur alle Abläufe</button>' : ''}
          <span class="small muted">${allHtml ? 'Abläufe + Patchlisten aller Tage – einzelne Tage unten oder im jeweiligen Tag' : 'Noch nichts zu drucken'}</span>
        </div>
      </div>

      <section class="card pool">
        <div class="page-head"><h3>🗂 Bands ohne Tag ${pool.length ? `<span class="badge">${pool.length}</span>` : ''}</h3></div>
        <p class="small muted">Bands, die schon feststehen, aber noch keinem Tag oder keiner Bühne zugeteilt sind. Rider kannst du trotzdem schon ablegen.</p>
        ${pool.length ? `<div class="pool-list">${pool.map(({ e, b }) => `
          <div class="pool-row">
            <a href="#/band/${b.id}" class="grow"><b>${esc(b.name)}</b></a>
            ${hasDocs(e) ? '<span class="badge ok">Rider</span>' : '<span class="badge warn">kein Rider</span>'}
            ${days.length ? `<select data-assign="${b.id}" aria-label="${esc(b.name)} einteilen"><option value="">Einteilen in …</option>${moveOptions(fest, f.id)}</select>` : ''}
            <button class="icon" data-prm="${b.id}" title="Aus dem Festival entfernen">✕</button>
          </div>`).join('')}</div>` : ''}
        <form class="add-band pool-add" autocomplete="off">
          <input name="band" list="dl-pool" placeholder="Band hinzufügen (ohne Tag) …">
          <datalist id="dl-pool">${bands.filter((b) => !f.lineup.some((e) => e.bandId === b.id)).sort(byName).map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
          <button class="primary">+ Band</button>
        </form>
      </section>

      <h3 class="section">Tage</h3>
      <div class="list">${gs.map(dayCard).join('') || '<div class="empty"><p class="muted">Noch keine Tage.</p><button class="primary" data-fadd2>＋ Tag hinzufügen</button></div>'}</div>
      ${rows.length || pool.length ? `<h3 class="section">Alle Bands (${new Set([...rows, ...pool].map((x) => x.b.id)).size})</h3>
      <div class="table-wrap"><table class="ptable">
        <thead><tr><th>Band</th><th>Tag / Bühne</th><th>Spielzeit</th><th>Rider</th><th></th></tr></thead>
        <tbody>${rows.map(({ d, e, b }) => `<tr>
          <td><a href="#/band/${b.id}"><b>${esc(b.name)}</b></a></td>
          <td><a href="#/concert/${f.id}/${d.id}">${esc(dayName(d))}</a> <span class="muted small">${shortDate(d.date)}</span></td>
          <td>${esc(e.time || '–')}</td>
          <td>${hasDocs(e) ? '<span class="badge ok">da</span>' : '<span class="badge warn">fehlt</span>'}</td>
          <td><a class="small" href="#/band/${b.id}/patch/${d.profileId || f.profileId || ''}/${d.id}">🎛 Patch</a></td></tr>`).join('')}
          ${pool.map(({ e, b }) => `<tr class="empty-row"><td><a href="#/band/${b.id}"><b>${esc(b.name)}</b></a></td><td class="muted">noch ohne Tag</td><td>–</td>
            <td>${hasDocs(e) ? '<span class="badge ok">da</span>' : '<span class="badge warn">fehlt</span>'}</td><td></td></tr>`).join('')}</tbody>
      </table></div>` : ''}`;

    bindHead(fest);
    const add2 = $('[data-fadd2]');
    if (add2) add2.onclick = () => addDayDialog(f);
    const fp = $('[data-fprofile]');
    if (fp) fp.onchange = async () => {
      const old = f.profileId;
      f.profileId = fp.value || null;
      await DB.put('concerts', f);
      for (const d of days) if (!d.profileId || d.profileId === old) { d.profileId = f.profileId; await DB.put('concerts', d); }
      render();
    };
    $('[data-pall]').onclick = () => printPages(allHtml);
    const ps = $('[data-pallsched]');
    if (ps) ps.onclick = () => printPages(allSched);
    $$('[data-pgroup]').forEach((b) => (b.onclick = () => printPages(gPrint(gs[+b.dataset.pgroup]))));
    $$('[data-pgsched]').forEach((b) => (b.onclick = () => printPages(gSched(gs[+b.dataset.pgsched]))));
    $$('[data-pday]').forEach((b) => (b.onclick = () => printPages(prints.get(b.dataset.pday).html)));
    $$('[data-assign]').forEach((s) => (s.onchange = () => s.value && moveBand(f.id, s.dataset.assign, s.value)));
    $$('[data-prm]').forEach((b) => (b.onclick = async () => {
      f.lineup = f.lineup.filter((e) => e.bandId !== b.dataset.prm);
      await DB.put('concerts', f);
      render();
    }));
    $('.pool-add').onsubmit = (e) => { e.preventDefault(); addBandToConcert(f.id, e.target.band.value); };
  }

  /* ---------- Karte in der Konzertliste ---------- */
  function card(f, days, bandMap, docMap, isPast) {
    const t = today();
    const next = days.find((d) => d.date && d.date >= t);
    const shown = next || days[0];
    const rel = next ? relDay(next.date) : '';
    const all = [...days.flatMap((d) => d.lineup), ...(f.lineup || [])];
    const bandsAll = [];
    for (const e of all) if (!bandsAll.some((x) => x.id === e.bandId)) bandsAll.push({ id: e.bandId, ok: all.some((x) => x.bandId === e.bandId && x.docIds.some((id) => docMap.has(id))) });
    const ongoing = days.some((d) => d.date === t);
    return `
    <a class="card concert-card fest-card ${isPast ? 'past' : ''}" href="#/concert/${f.id}">
      <div class="date-box fest-box">${shown?.date ? `<span>${fmtWeekday(shown.date)}</span><b>${toDate(shown.date).getDate()}</b><span>${toDate(shown.date).toLocaleDateString('de-DE', { month: 'short' })}</span>` : '<b>?</b>'}</div>
      <div class="grow">
        <div class="card-top"><span class="badge fest">🎪 Festival · ${countLabel(days)}</span>${ongoing ? '<span class="badge accent">läuft</span>' : rel && !isPast ? `<span class="badge">${rel}</span>` : ''}${f.lineup?.length ? `<span class="badge warn">${f.lineup.length} ohne Tag</span>` : ''}${Share.badge(f)}</div>
        <div class="card-title">${esc(f.title)}</div>
        <div class="muted small">${[range(days), f.venue && esc(f.venue)].filter(Boolean).join(' · ')}</div>
        <div class="band-chips">${bandsAll.slice(0, 14).map((x) => `<span class="bchip ${x.ok ? 'ok' : 'missing'}">${esc(bandMap.get(x.id)?.name || '?')}</span>`).join('')}${bandsAll.length > 14 ? `<span class="muted small">+${bandsAll.length - 14} weitere</span>` : ''}${!bandsAll.length ? '<span class="muted small">noch keine Bands</span>' : ''}</div>
      </div>
    </a>`;
  }

  return { isFestival, createDialog, prepare, head, bindHead, dayHead, dayDialog, overview, card, daysOf, moveOptions, moveBand, dayName };
})();
