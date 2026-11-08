'use strict';
/* ======================================================================
   Festivals: ein Festival mit mehreren Tagen (optional mehreren Bühnen).
   Jeder Tag ist intern ein normales Konzert (festivalId → Festival),
   damit Line-up, Tagesablauf, Rider, Patchlisten und Drucken pro Tag funktionieren.
   ====================================================================== */
const Festival = (() => {
  const isFestival = (c) => c?.kind === 'festival';
  const dayTitle = (f, d) => `${f.title} – ${d.dayLabel || 'Tag'}${d.stage ? ' · ' + d.stage : ''}`;
  const shortDate = (iso) => (iso ? toDate(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'ohne Datum');
  const range = (days) => {
    const ds = days.map((d) => d.date).filter(Boolean).sort();
    if (!ds.length) return '';
    const a = toDate(ds[0]), b = toDate(ds[ds.length - 1]);
    if (ds[0] === ds[ds.length - 1]) return fmtDate(ds[0]);
    const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    return sameMonth ? `${String(a.getDate()).padStart(2, '0')}.–${fmtDate(ds[ds.length - 1])}` : `${fmtDate(ds[0])} – ${fmtDate(ds[ds.length - 1])}`;
  };
  const daysOf = (f, concerts) => concerts.filter((c) => c.festivalId === f.id).sort((a, b) => concertKey(a).localeCompare(concertKey(b)) || (a.stage || '').localeCompare(b.stage || ''));
  const plusDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  // Titel/Ort der Tage nach Änderungen am Festival nachziehen
  async function syncDays(f) {
    for (const d of daysOf(f, await Data.concerts())) {
      const t = dayTitle(f, d);
      if (d.title !== t || d.venue !== f.venue) { d.title = t; d.venue = f.venue; await DB.put('concerts', d); }
    }
  }

  /* ---------- Anlegen / Bearbeiten ---------- */
  async function createDialog() {
    const res = await modal(`
      <div class="modal-head"><h2>🎪 Neues Festival</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form" novalidate>
        <label>Name <input name="title" required placeholder="z. B. Rock am See 2027" autofocus></label>
        <label>Ort <input name="venue" placeholder="Gelände, Stadt"></label>
        <div class="row2">
          <label>Erster Tag <input type="date" name="date" value="${today()}"></label>
          <label>Anzahl Tage <input type="number" name="n" min="1" max="14" value="3"></label>
        </div>
        <label>Bühnen <span class="muted small">(optional, mit Komma getrennt – dann gibt es pro Tag und Bühne einen eigenen Bereich)</span>
          <input name="stages" placeholder="z. B. Hauptbühne, Zeltbühne"></label>
        <label>Notizen <textarea name="notes" rows="2" placeholder="Produktion, Ansprechpartner, Anfahrt …"></textarea></label>
        <p class="error" hidden></p>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Anlegen</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      f.onsubmit = (e) => {
        e.preventDefault();
        if (!f.elements.namedItem('title').value.trim()) { const er = $('.error', el); er.textContent = 'Bitte einen Namen angeben.'; er.hidden = false; return; }
        done({ title: f.elements.namedItem('title').value.trim(), venue: f.venue.value.trim(), date: f.date.value || today(), n: Math.min(14, Math.max(1, +f.n.value || 1)),
          stages: f.stages.value.split(',').map((s) => s.trim()).filter(Boolean), notes: f.notes.value.trim() });
      };
    });
    if (!res) return;
    const fest = { id: uid(), kind: 'festival', title: res.title, venue: res.venue, notes: res.notes, lineup: [], createdAt: nowIso() };
    await DB.put('concerts', fest);
    for (let i = 0; i < res.n; i++) {
      for (const stage of res.stages.length ? res.stages : ['']) {
        const d = { id: uid(), festivalId: fest.id, dayLabel: `Tag ${i + 1}`, stage, date: plusDays(res.date, i), time: '', venue: fest.venue, notes: '', lineup: [], createdAt: nowIso() };
        d.title = dayTitle(fest, d);
        await DB.put('concerts', d);
      }
    }
    location.hash = '#/concert/' + fest.id;
  }

  async function editDialog(f) {
    const res = await modal(`
      <div class="modal-head"><h2>Festival bearbeiten</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <label>Name <input name="title" required value="${esc(f.title)}"></label>
        <label>Ort <input name="venue" value="${esc(f.venue || '')}"></label>
        <label>Notizen <textarea name="notes" rows="3">${esc(f.notes || '')}</textarea></label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      const fm = $('form', el);
      fm.onsubmit = (e) => { e.preventDefault(); done({ title: fm.elements.namedItem('title').value.trim() || f.title, venue: fm.venue.value.trim(), notes: fm.notes.value.trim() }); };
    });
    if (!res) return;
    Object.assign(f, res);
    await DB.put('concerts', f);
    await syncDays(f);
    render();
  }

  async function dayDialog(f, day = null) {
    const days = daysOf(f, await Data.concerts());
    const last = days[days.length - 1];
    const res = await modal(`
      <div class="modal-head"><h2>${day ? 'Tag bearbeiten' : 'Tag / Bühne hinzufügen'}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <div class="row2">
          <label>Bezeichnung <input name="label" value="${esc(day?.dayLabel || `Tag ${days.length + 1}`)}" placeholder="z. B. Tag 2 oder Freitag"></label>
          <label>Bühne <input name="stage" value="${esc(day?.stage || '')}" placeholder="optional"></label>
        </div>
        <div class="row2">
          <label>Datum <input type="date" name="date" value="${esc(day?.date || (last?.date ? plusDays(last.date, 1) : today()))}"></label>
          <label>Beginn <input type="time" name="time" value="${esc(day?.time || '')}"></label>
        </div>
        <label>Notizen <textarea name="notes" rows="2">${esc(day?.notes || '')}</textarea></label>
        <div class="actions">${day ? '<button type="button" class="ghost danger-text" data-del>Tag löschen</button><span class="grow"></span>' : ''}
          <button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      const fm = $('form', el);
      const del = $('[data-del]', el);
      if (del) del.onclick = () => done('delete');
      fm.onsubmit = (e) => { e.preventDefault(); done({ dayLabel: fm.label.value.trim() || 'Tag', stage: fm.stage.value.trim(), date: fm.date.value, time: fm.time.value, notes: fm.notes.value.trim() }); };
    });
    if (!res) return;
    if (res === 'delete') {
      if (!(await confirmDialog(`„${esc(day.dayLabel)}${day.stage ? ' · ' + esc(day.stage) : ''}“ mit Line-up und Ablauf löschen? Die Rider bleiben bei den Bands.`, 'Löschen', true))) return;
      await DB.del('concerts', day.id);
      location.hash = '#/concert/' + f.id;
      return;
    }
    const d = day || { id: uid(), festivalId: f.id, lineup: [], profileId: f.profileId || null, createdAt: nowIso() };
    Object.assign(d, res, { venue: f.venue });
    d.title = dayTitle(f, d);
    await DB.put('concerts', d);
    if (day) render(); else location.hash = `#/concert/${f.id}/${d.id}`;
  }

  async function remove(f) {
    const days = daysOf(f, await Data.concerts());
    if (!(await confirmDialog(`Festival „${esc(f.title)}“ mit ${days.length} Tag${days.length === 1 ? '' : 'en'} löschen? Die Rider bleiben bei den Bands gespeichert.`, 'Löschen', true))) return;
    for (const d of days) await DB.del('concerts', d.id);
    await DB.del('concerts', f.id);
    location.hash = '#/concerts';
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
    const tab = (d) => `<a href="#/concert/${f.id}/${d.id}" class="${day?.id === d.id ? 'active' : ''}">${esc(d.dayLabel || 'Tag')}${d.stage ? ` <span class="muted">· ${esc(d.stage)}</span>` : ''}<small>${shortDate(d.date)}${d.date === today() ? ' · heute' : ''}</small></a>`;
    return `
      <a class="back no-print" href="#/concerts">‹ Konzerte</a>
      <div class="page-head">
        <div><span class="badge fest">🎪 Festival</span><h1>${esc(f.title)}</h1>
          <div class="muted">${[range(days), `${days.length} ${days.length === 1 ? 'Tag' : 'Tage'}${new Set(days.map((d) => d.stage).filter(Boolean)).size > 1 ? ' / Bühnen' : ''}`, f.venue && esc(f.venue)].filter(Boolean).join(' · ')}</div></div>
        <div class="head-actions"><button class="ghost" data-fedit>Bearbeiten</button><button class="ghost danger-text" data-fdel>Löschen</button></div>
      </div>
      <nav class="subtabs day-tabs no-print">
        <a href="#/concert/${f.id}/uebersicht" class="${day ? '' : 'active'}">Übersicht<small>${days.length} ${days.length === 1 ? 'Tag' : 'Tage'}</small></a>
        ${days.map(tab).join('')}
        <a href="#" data-fadd class="add-day">＋ Tag<small>hinzufügen</small></a>
      </nav>`;
  }

  function bindHead(fest) {
    $('[data-fedit]').onclick = () => editDialog(fest.f);
    $('[data-fdel]').onclick = () => remove(fest.f);
    $('[data-fadd]').onclick = (e) => { e.preventDefault(); dayDialog(fest.f); };
  }

  // Kopf eines Tages innerhalb der Festivalseite (ersetzt den normalen Konzertkopf)
  function dayHead(fest) {
    const d = fest.day;
    const rel = relDay(d.date);
    return `
      <div class="page-head day-head">
        <div><h2>${esc(d.dayLabel || 'Tag')}${d.stage ? ` · ${esc(d.stage)}` : ''}</h2>
          <div class="muted">${[d.date && fmtWeekday(d.date) + ', ' + fmtDate(d.date), d.time && d.time + ' Uhr'].filter(Boolean).join(' · ')}
            ${rel ? `<span class="badge ${rel === 'Heute' ? 'accent' : ''}">${rel}</span>` : ''}</div></div>
        <div class="head-actions"><button class="ghost" data-editc>Tag bearbeiten</button></div>
      </div>`;
  }

  async function overview(fest) {
    const { f, days } = fest;
    const [bands, docs, profiles] = await Promise.all([Data.bands(), Data.docs(), DB.all('profiles')]);
    profiles.sort(byName);
    const bandMap = new Map(bands.map((b) => [b.id, b]));
    const docMap = new Map(docs.map((d) => [d.id, d]));
    // Druckseiten pro Tag vorbereiten (Drucken muss sofort beim Antippen starten)
    const prints = new Map(days.map((d) => [d.id, PatchUI.concertSheets(d, profiles, bands, docs)]));
    const schedOnly = new Map(days.map((d) => [d.id, (d.schedule || []).length ? Schedule.sheet(d, bandMap) : '']));
    const allHtml = days.map((d) => prints.get(d.id).html).join('');
    const allSched = days.map((d) => schedOnly.get(d.id)).join('');
    const nBands = new Set(days.flatMap((d) => d.lineup.map((e) => e.bandId))).size;

    const dayCard = (d) => {
      const p = prints.get(d.id);
      return `
      <div class="card fest-day">
        <a class="fest-day-main" href="#/concert/${f.id}/${d.id}">
          <div class="date-box">${d.date ? `<span>${fmtWeekday(d.date)}</span><b>${toDate(d.date).getDate()}</b><span>${toDate(d.date).toLocaleDateString('de-DE', { month: 'short' })}</span>` : '<b>?</b>'}</div>
          <div class="grow">
            <div class="card-title">${esc(d.dayLabel || 'Tag')}${d.stage ? ` · ${esc(d.stage)}` : ''} ${d.date === today() ? '<span class="badge accent">Heute</span>' : ''}</div>
            <div class="muted small">${[d.time && 'Beginn ' + d.time, Schedule.summary(d), (d.schedule || []).length && `${d.schedule.length} Punkte im Ablauf`].filter(Boolean).join(' · ') || 'noch kein Ablauf'}</div>
            <div class="band-chips">${d.lineup.map((e) => `<span class="bchip ${e.docIds.some((x) => docMap.has(x)) ? 'ok' : 'missing'}">${esc(bandMap.get(e.bandId)?.name || '?')}${e.time ? ` <span class="muted">${esc(e.time)}</span>` : ''}</span>`).join('') || '<span class="muted small">noch keine Bands</span>'}</div>
          </div>
        </a>
        <div class="fest-day-actions no-print">
          ${p.html ? `<button class="ghost small-btn" data-pday="${d.id}" title="Ablauf + Patchlisten dieses Tages">🖨 Tag drucken</button>` : ''}
          ${schedOnly.get(d.id) ? `<button class="ghost small-btn" data-psched="${d.id}">🕒 Ablauf</button>` : ''}
        </div>
      </div>`;
    };

    // Alle Bands des Festivals mit Tag und Spielzeit
    const rows = days.flatMap((d) => d.lineup.map((e) => ({ d, e, b: bandMap.get(e.bandId) }))).filter((x) => x.b);
    app().innerHTML = head(fest) + `
      ${f.notes ? `<div class="notes">${esc(f.notes)}</div>` : ''}
      <div class="concert-tools card">
        ${profiles.length ? `<label class="lbl">🎛 Stagebox für das Festival
          <select data-fprofile><option value="">– wählen –</option>${profiles.map((p) => `<option value="${p.id}" ${p.id === f.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <span class="small muted">gilt für alle Tage – pro Tag änderbar</span></label>` : '<p class="small muted">Lege unter „Stagebox“ ein Profil an, um Patchlisten zu erzeugen.</p>'}
        <div class="printall-wrap">
          <button class="primary" data-pall ${allHtml ? '' : 'disabled'}>🖨 Ganzes Festival drucken</button>
          ${allSched ? '<button class="ghost small-btn" data-pallsched>🕒 Nur alle Abläufe</button>' : ''}
          <span class="small muted">${allHtml ? 'Abläufe + Patchlisten aller Tage – einzelne Tage unten oder im jeweiligen Tag' : 'Noch nichts zu drucken'}</span>
        </div>
      </div>
      <h3 class="section">Tage</h3>
      <div class="list">${days.map(dayCard).join('') || '<div class="empty"><p class="muted">Noch keine Tage.</p><button class="primary" data-fadd2>＋ Tag hinzufügen</button></div>'}</div>
      ${rows.length ? `<h3 class="section">Alle Bands (${nBands})</h3>
      <div class="table-wrap"><table class="ptable">
        <thead><tr><th>Band</th><th>Tag</th><th>Spielzeit</th><th>Rider</th><th></th></tr></thead>
        <tbody>${rows.map(({ d, e, b }) => `<tr>
          <td><a href="#/band/${b.id}"><b>${esc(b.name)}</b></a></td>
          <td><a href="#/concert/${f.id}/${d.id}">${esc(d.dayLabel || 'Tag')}${d.stage ? ' · ' + esc(d.stage) : ''}</a> <span class="muted small">${shortDate(d.date)}</span></td>
          <td>${esc(e.time || '–')}</td>
          <td>${e.docIds.some((x) => docMap.has(x)) ? '<span class="badge ok">da</span>' : '<span class="badge warn">fehlt</span>'}</td>
          <td><a class="small" href="#/band/${b.id}/patch/${d.profileId || f.profileId || ''}/${d.id}">🎛 Patch</a></td></tr>`).join('')}</tbody>
      </table></div>` : ''}`;
    bindHead(fest);
    const add2 = $('[data-fadd2]');
    if (add2) add2.onclick = () => dayDialog(f);
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
    $$('[data-pday]').forEach((b) => (b.onclick = () => printPages(prints.get(b.dataset.pday).html)));
    $$('[data-psched]').forEach((b) => (b.onclick = () => printPages(schedOnly.get(b.dataset.psched))));
  }

  /* ---------- Karte in der Konzertliste ---------- */
  function card(f, days, bandMap, docMap, isPast) {
    const t = today();
    const next = days.find((d) => d.date && d.date >= t);
    const shown = next || days[0];
    const rel = next ? relDay(next.date) : '';
    const bandsAll = [];
    for (const d of days) for (const e of d.lineup) if (!bandsAll.some((x) => x.id === e.bandId)) bandsAll.push({ id: e.bandId, ok: days.some((dd) => dd.lineup.some((x) => x.bandId === e.bandId && x.docIds.some((id) => docMap.has(id)))) });
    const ongoing = days.some((d) => d.date === t);
    return `
    <a class="card concert-card fest-card ${isPast ? 'past' : ''}" href="#/concert/${f.id}">
      <div class="date-box fest-box">${shown?.date ? `<span>${fmtWeekday(shown.date)}</span><b>${toDate(shown.date).getDate()}</b><span>${toDate(shown.date).toLocaleDateString('de-DE', { month: 'short' })}</span>` : '<b>?</b>'}</div>
      <div class="grow">
        <div class="card-top"><span class="badge fest">🎪 Festival · ${days.length} ${days.length === 1 ? 'Tag' : 'Tage'}</span>${ongoing ? '<span class="badge accent">läuft</span>' : rel && !isPast ? `<span class="badge">${rel}</span>` : ''}</div>
        <div class="card-title">${esc(f.title)}</div>
        <div class="muted small">${[range(days), f.venue && esc(f.venue)].filter(Boolean).join(' · ')}</div>
        <div class="band-chips">${bandsAll.slice(0, 14).map((x) => `<span class="bchip ${x.ok ? 'ok' : 'missing'}">${esc(bandMap.get(x.id)?.name || '?')}</span>`).join('')}${bandsAll.length > 14 ? `<span class="muted small">+${bandsAll.length - 14} weitere</span>` : ''}${!bandsAll.length ? '<span class="muted small">noch keine Bands</span>' : ''}</div>
      </div>
    </a>`;
  }

  return { isFestival, createDialog, prepare, head, bindHead, dayHead, dayDialog, overview, card, daysOf };
})();
