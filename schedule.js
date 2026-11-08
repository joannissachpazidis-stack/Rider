'use strict';
/* ======================================================================
   Tagesablauf eines Konzerts: Get-in, Soundchecks, Einlass, Shows, Umbauten …
   ====================================================================== */
const Schedule = (() => {
  const TYPES = {
    getin: ['🚚', 'Get-in / Ankunft'],
    aufbau: ['🔧', 'Aufbau'],
    linecheck: ['🎚', 'Line-Check'],
    soundcheck: ['🔊', 'Soundcheck'],
    catering: ['🍽', 'Catering / Essen'],
    doors: ['🚪', 'Einlass'],
    show: ['🎤', 'Show'],
    changeover: ['🔁', 'Umbau'],
    break: ['☕', 'Pause'],
    curfew: ['🛑', 'Curfew / Ende'],
    getout: ['📦', 'Abbau / Get-out'],
    other: ['📌', 'Sonstiges'],
  };

  /* ---------- Zeit-Helfer ---------- */
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const fromMin = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  // Zeiten nach Mitternacht (bis 6 Uhr) gehören noch zum selben Abend
  const key = (t) => { const m = toMin(t); return m === null ? 99999 : m < 360 ? m + 1440 : m; };
  const sorted = (c) => [...(c.schedule || [])].sort((a, b) => key(a.time) - key(b.time) || (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99));
  const TYPE_ORDER = Object.fromEntries(Object.keys(TYPES).map((k, i) => [k, i]));
  const dur = (it) => { const s = key(it.time), e = key(it.end); return it.end && e > s ? e - s : null; };
  const label = (it, bandMap) => {
    const [icon, name] = TYPES[it.type] || TYPES.other;
    const band = it.bandId ? bandMap.get(it.bandId)?.name : '';
    return { icon, name: it.type === 'other' && it.title ? it.title : name, band: band || '' };
  };

  // Aktuelle Uhrzeit als Ablauf-Schlüssel, wenn das Konzert gerade läuft (Konzerttag ab 6 Uhr oder die Nacht danach)
  function liveKey(c) {
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    const y = new Date(now); y.setDate(y.getDate() - 1); y.setMinutes(y.getMinutes() - y.getTimezoneOffset());
    if (c.date === today() && m >= 360) return m;
    if (c.date === y.toISOString().slice(0, 10) && m < 360) return m + 1440;
    return null;
  }

  /* ---------- Soundcheck-/Umbauzeiten aus den Ridern ---------- */
  function riderTimes(docs) {
    const out = {};
    for (const s of Patch.sentencesOf(docs.filter((d) => !d.archived))) {
      for (const m of s.text.matchAll(/\b(soundcheck|line ?check|changeover|umbau\w*)\b[^!?;\d]{0,30}(\d{1,3})\s*(min\w*|minuten|minutes|std|h\b|stunden?|hours?)/gi)) {
        const n = +m[2] * (/^(std|h|stund|hour)/i.test(m[3]) ? 60 : 1);
        const k = /sound/i.test(m[1]) ? 'soundcheck' : /line/i.test(m[1]) ? 'linecheck' : 'changeover';
        if (n >= 5 && n <= 240) out[k] = Math.max(out[k] || 0, n);
      }
    }
    return out;
  }

  /* ---------- Ansicht auf der Konzertseite ---------- */
  function html(c, bandMap) {
    const items = sorted(c);
    const nowK = liveKey(c);
    const isToday = nowK !== null;
    let current = -1;
    if (isToday) items.forEach((it, i) => { if (key(it.time) <= nowK) current = i; });
    const curfew = items.find((x) => x.type === 'curfew');
    const lateShow = curfew && items.filter((x) => x.type === 'show').find((x) => key(x.end || x.time) > key(curfew.time));
    const rows = items.map((it, i) => {
      const { icon, name, band } = label(it, bandMap);
      const next = items[i + 1];
      const overlap = it.end && next && key(it.end) > key(next.time);
      const d = dur(it);
      return `<li class="sched-item t-${it.type} ${i === current ? 'now' : ''} ${isToday && i < current ? 'done' : ''}" data-sid="${it.id}" tabindex="0" role="button" aria-label="${esc(name)} bearbeiten">
        <div class="sched-time"><b>${esc(it.time || '–')}</b>${it.end ? `<span>– ${esc(it.end)}</span>` : ''}</div>
        <div class="sched-dot">${icon}</div>
        <div class="sched-body">
          <div><b>${esc(name)}</b>${band ? ` · <span class="sched-band">${esc(band)}</span>` : ''}${i === current ? ' <span class="badge accent">Jetzt</span>' : ''}${d ? ` <span class="muted small">${d} min</span>` : ''}</div>
          ${it.note ? `<div class="small muted">${esc(it.note)}</div>` : ''}
          ${overlap && next.type !== 'curfew' ? `<div class="small warn-text">⚠ überschneidet sich mit ${esc(label(next, bandMap).name)} um ${esc(next.time)}</div>` : ''}
          ${it === curfew && lateShow ? `<div class="small warn-text">⚠ ${esc(label(lateShow, bandMap).band || 'Eine Show')} endet erst ${esc(lateShow.end || lateShow.time)}</div>` : ''}
        </div>
      </li>`;
    }).join('');
    return `
      <section class="card schedule" id="ablauf">
        <div class="page-head"><h3>🕒 Tagesablauf</h3>
          <div class="head-actions">
            ${items.length ? '<button class="ghost small-btn" data-sshift title="Bei Verzug alles Folgende verschieben">⏱ Verschieben</button>' : ''}
            <button class="ghost small-btn" data-sgen>✨ ${items.length ? 'Neu erstellen' : 'Ablauf erstellen'}</button>
            <button class="primary small-btn" data-sadd>+ Eintrag</button>
          </div></div>
        ${items.length ? `<ol class="sched-list">${rows}</ol>
          <div class="actions left"><button class="ghost small-btn" data-scopy>📋 Als Text kopieren</button><button class="ghost small-btn" data-sprint>🖨 Ablauf drucken</button></div>`
        : '<p class="muted small">Noch kein Ablauf. „Ablauf erstellen“ macht einen Vorschlag aus dem Line-up (Get-in, Soundchecks in umgekehrter Reihenfolge, Einlass, Shows, Umbauten) – alles lässt sich danach anpassen.</p>'}
      </section>`;
  }

  function bind(c, bandMap, docs) {
    const root = $('#ablauf');
    if (!root) return;
    const open = (id) => itemDialog(c, bandMap, id);
    $$('[data-sid]', root).forEach((li) => {
      li.onclick = () => open(li.dataset.sid);
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(li.dataset.sid); } };
    });
    $('[data-sadd]', root).onclick = () => open(null);
    $('[data-sgen]', root).onclick = () => generateDialog(c, bandMap, docs);
    const sh = $('[data-sshift]', root);
    if (sh) sh.onclick = () => shiftDialog(c, bandMap);
    const cp = $('[data-scopy]', root);
    if (cp) cp.onclick = async () => {
      const t = asText(c, bandMap);
      try { await navigator.clipboard.writeText(t); toast('Ablauf kopiert – z. B. in WhatsApp oder eine Mail einfügen'); } catch { modal(`<h2>Tagesablauf</h2><textarea rows="14" class="mono">${esc(t)}</textarea><div class="actions"><button class="primary" data-close>OK</button></div>`); }
    };
    const pr = $('[data-sprint]', root);
    if (pr) pr.onclick = () => print(c, bandMap);
  }

  async function save(c) {
    // Showzeiten mit den Spielzeiten im Line-up abgleichen
    for (const it of c.schedule || []) {
      if (it.type === 'show' && it.bandId) { const e = c.lineup.find((x) => x.bandId === it.bandId); if (e) e.time = it.time; }
    }
    await DB.put('concerts', c);
    render();
  }

  /* ---------- Eintrag bearbeiten ---------- */
  async function itemDialog(c, bandMap, id) {
    const it = id ? (c.schedule || []).find((x) => x.id === id) : null;
    const last = sorted(c).pop();
    const res = await modal(`
      <div class="modal-head"><h2>${it ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <div class="row2">
          <label>Was <select name="type">${Object.entries(TYPES).map(([k, [i, n]]) => `<option value="${k}" ${k === (it?.type || 'soundcheck') ? 'selected' : ''}>${i} ${n}</option>`).join('')}</select></label>
          <label>Band <select name="band"><option value="">– keine –</option>${c.lineup.map((e) => `<option value="${e.bandId}" ${e.bandId === it?.bandId ? 'selected' : ''}>${esc(bandMap.get(e.bandId)?.name || '?')}</option>`).join('')}</select></label>
        </div>
        <label class="title-wrap">Bezeichnung <input name="title" value="${esc(it?.title || '')}" placeholder="z. B. Pressetermin"></label>
        <div class="row2">
          <label>Beginn <input type="time" name="time" required value="${esc(it?.time || (last?.end || last?.time || c.time || ''))}"></label>
          <label>Ende <input type="time" name="end" value="${esc(it?.end || '')}"></label>
        </div>
        <div class="quick-dur small">Dauer: ${[10, 15, 20, 30, 45, 60, 90].map((m) => `<button type="button" class="ghost small-btn" data-dur="${m}">${m}′</button>`).join('')}</div>
        <label>Notiz <input name="note" value="${esc(it?.note || '')}" placeholder="z. B. nur Line-Check, Catering im Backstage"></label>
        <p class="error" hidden></p>
        <div class="actions">${it ? '<button type="button" class="ghost danger-text" data-del>Löschen</button><span class="grow"></span>' : ''}
          <button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      const upd = () => { $('.title-wrap', el).hidden = f.type.value !== 'other'; };
      f.type.onchange = upd; upd();
      $$('[data-dur]', el).forEach((b) => (b.onclick = () => { const s = toMin(f.time.value); if (s !== null) f.end.value = fromMin(s + +b.dataset.dur); }));
      const del = $('[data-del]', el);
      if (del) del.onclick = () => done('delete');
      f.onsubmit = (e) => {
        e.preventDefault();
        if (!f.time.value) { const er = $('.error', el); er.textContent = 'Bitte eine Uhrzeit angeben.'; er.hidden = false; return; }
        done({ type: f.type.value, bandId: f.band.value || null, title: f.elements.namedItem('title').value.trim(), time: f.time.value, end: f.end.value, note: f.note.value.trim() });
      };
    });
    if (!res) return;
    c.schedule ||= [];
    if (res === 'delete') c.schedule = c.schedule.filter((x) => x.id !== id);
    else if (it) Object.assign(it, res);
    else c.schedule.push({ id: uid(), ...res });
    await save(c);
  }

  /* ---------- Vorschlag erzeugen ---------- */
  async function generateDialog(c, bandMap, docs) {
    if (!c.lineup.length) { toast('Erst Bands ins Line-up eintragen'); return; }
    const per = c.lineup.map((e) => ({ e, b: bandMap.get(e.bandId), t: riderTimes(docs.filter((d) => d.bandId === e.bandId)) }));
    const show = toMin(c.time) ?? toMin(c.lineup.find((e) => e.time)?.time) ?? 20 * 60;
    const fromRider = per.filter((x) => x.t.soundcheck);
    const res = await modal(`
      <div class="modal-head"><h2>✨ Ablauf erstellen</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <p class="small muted">Erstellt einen Vorschlag aus dem Line-up. Danach kannst du jeden Eintrag anpassen.${(c.schedule || []).length ? ' <b>Der bisherige Ablauf wird ersetzt.</b>' : ''}</p>
      <form class="form">
        <div class="row2">
          <label>Get-in <input type="time" name="getin" value="${fromMin(Math.max(show - 6 * 60, 8 * 60))}"></label>
          <label>Aufbau (min) <input type="number" name="aufbau" min="0" step="5" value="60"></label>
        </div>
        <div class="row2">
          <label>Soundcheck je Band (min) <input type="number" name="sc" min="5" step="5" value="45"></label>
          <label>Pause dazwischen (min) <input type="number" name="gap" min="0" step="5" value="10"></label>
        </div>
        ${fromRider.length ? `<p class="small hint">Aus den Ridern übernommen: ${fromRider.map((x) => `${esc(x.b?.name)} ${x.t.soundcheck} min`).join(', ')}</p>` : ''}
        <label>Soundcheck-Reihenfolge <select name="order"><option value="reverse">Umgekehrt (letzte Band zuerst) – üblich</option><option value="lineup">Wie im Line-up</option></select></label>
        <div class="row2">
          <label>Einlass <input type="time" name="doors" value="${fromMin(show - 60)}"></label>
          <label>Show-Beginn <input type="time" name="show" value="${fromMin(show)}"></label>
        </div>
        <div class="row2">
          <label>Set-Länge (min) <input type="number" name="set" min="10" step="5" value="45"></label>
          <label>Umbau (min) <input type="number" name="co" min="0" step="5" value="${Math.max(20, ...per.map((x) => x.t.changeover || 0))}"></label>
        </div>
        <div class="row2">
          <label class="check"><input type="checkbox" name="catering" checked> Catering vor Einlass</label>
          <label>Curfew <input type="time" name="curfew" value=""></label>
        </div>
        <label class="check"><input type="checkbox" name="keep" checked> Bereits eingetragene Spielzeiten aus dem Line-up beibehalten</label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Erstellen</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      f.onsubmit = (e) => {
        e.preventDefault();
        const n = (k) => Math.max(0, +f[k].value || 0);
        done({ getin: toMin(f.getin.value), aufbau: n('aufbau'), sc: n('sc') || 45, gap: n('gap'), order: f.order.value, doors: toMin(f.doors.value), show: toMin(f.show.value) ?? show, set: n('set') || 45, co: n('co'), catering: f.catering.checked, curfew: f.curfew.value, keep: f.keep.checked });
      };
    });
    if (!res) return;
    const items = [];
    const add = (type, start, end, bandId = null, note = '') => items.push({ id: uid(), type, time: fromMin(start), end: end != null ? fromMin(end) : '', bandId, note, title: '' });
    let t = res.getin ?? 14 * 60;
    add('getin', t, null);
    if (res.aufbau) { add('aufbau', t, t + res.aufbau); t += res.aufbau; }
    const order = res.order === 'reverse' ? [...per].reverse() : per;
    order.forEach((x, i) => {
      const d = x.t.soundcheck || res.sc;
      add('soundcheck', t, t + d, x.e.bandId, i === order.length - 1 && order.length > 1 && res.order === 'reverse' ? 'Bleibt danach auf der Bühne stehen (spielt zuerst)' : '');
      t += d + (i < order.length - 1 ? res.gap : 0);
    });
    const doors = res.doors ?? res.show - 60;
    if (res.catering && doors - t >= 30) add('catering', t + 10, Math.min(t + 70, doors));
    add('doors', doors, null);
    let cur = res.show;
    per.forEach((x, i) => {
      const fixed = res.keep && toMin(x.e.time) !== null ? toMin(x.e.time) : null;
      const start = fixed ?? cur;
      const nextFixed = res.keep && per[i + 1] && toMin(per[i + 1].e.time) !== null ? toMin(per[i + 1].e.time) : null;
      const end = nextFixed !== null && nextFixed - res.co > start ? nextFixed - res.co : start + res.set;
      add('show', start, end, x.e.bandId);
      if (i < per.length - 1 && res.co) add('changeover', end, end + res.co);
      cur = end + res.co;
    });
    if (res.curfew) add('curfew', toMin(res.curfew), null);
    c.schedule = items;
    await save(c);
    toast('Ablauf erstellt – Einträge antippen zum Anpassen');
  }

  /* ---------- Verzug: Folgendes verschieben ---------- */
  async function shiftDialog(c, bandMap) {
    const items = sorted(c);
    const res = await modal(`
      <div class="modal-head"><h2>⏱ Ablauf verschieben</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <label>Ab Eintrag <select name="from">${items.map((it) => { const l = label(it, bandMap); return `<option value="${it.id}">${esc(it.time)} – ${esc(l.name)}${l.band ? ' · ' + esc(l.band) : ''}</option>`; }).join('')}</select></label>
        <label>Um Minuten <input type="number" name="min" value="15" step="5"></label>
        <p class="small muted">Positive Zahl = später, negative = früher. Alle Einträge ab dem gewählten werden verschoben – die Curfew bleibt stehen.</p>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Verschieben</button></div>
      </form>`, (el, done) => {
      const f = $('form', el);
      const nowK = liveKey(c);
      if (nowK !== null) { const nxt = items.find((it) => key(it.time) >= nowK); if (nxt) f.from.value = nxt.id; }
      f.onsubmit = (e) => { e.preventDefault(); done({ from: f.from.value, min: +f.min.value || 0 }); };
    });
    if (!res || !res.min) return;
    const startK = key(items.find((x) => x.id === res.from)?.time);
    for (const it of c.schedule) {
      if (it.type !== 'curfew' && key(it.time) >= startK) {
        it.time = fromMin(toMin(it.time) + res.min);
        if (it.end) it.end = fromMin(toMin(it.end) + res.min);
      }
    }
    await save(c);
    toast(`Um ${res.min > 0 ? '+' : ''}${res.min} min verschoben`);
  }

  /* ---------- Text & Druck ---------- */
  function asText(c, bandMap) {
    const head = [c.title, c.date && fmtWeekday(c.date) + ', ' + fmtDate(c.date), c.venue].filter(Boolean).join(' – ');
    return head + '\n\n' + sorted(c).map((it) => {
      const { name, band } = label(it, bandMap);
      return `${it.time}${it.end ? '–' + it.end : ''}  ${name}${band ? ' · ' + band : ''}${it.note ? ' (' + it.note + ')' : ''}`;
    }).join('\n');
  }

  function sheet(c, bandMap) {
    return `
      <section class="print-sheet sched-sheet">
        <header class="ps-head"><h1>${esc(c.title)}</h1><p>Tagesablauf · ${[c.date && fmtWeekday(c.date) + ', ' + fmtDate(c.date), c.venue].filter(Boolean).map(esc).join(' · ')} · Stand ${fmtDate(today())}</p></header>
        <table class="ps-table">
          <thead><tr><th class="ps-time">Zeit</th><th class="ps-name">Programm</th><th class="ps-name">Band</th><th class="ps-x">Notiz</th></tr></thead>
          <tbody>${sorted(c).map((it) => { const { name, band } = label(it, bandMap); return `<tr class="${it.type === 'show' ? 'ps-show' : ''}"><td class="ps-time">${esc(it.time)}${it.end ? '–' + esc(it.end) : ''}</td><td class="ps-name">${esc(name)}</td><td class="ps-name">${esc(band)}</td><td class="ps-x">${esc(it.note || '')}</td></tr>`; }).join('')}</tbody>
        </table>
      </section>`;
  }

  function print(c, bandMap) {
    let root = $('#print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    root.innerHTML = sheet(c, bandMap);
    document.body.classList.add('print-all');
    const done = () => { document.body.classList.remove('print-all'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  /** Kurzinfo für die Konzertkarte, z. B. „Get-in 14:00“ */
  function summary(c) {
    const items = sorted(c);
    const gi = items.find((x) => x.type === 'getin') || items[0];
    return gi ? `${gi.type === 'getin' ? 'Get-in' : (TYPES[gi.type] || TYPES.other)[1]} ${gi.time}` : '';
  }

  return { html, bind, sheet, summary, riderTimes, TYPES };
})();
