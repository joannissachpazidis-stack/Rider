'use strict';
/* ======================================================================
   Smarter Import: Dateien reinziehen → Band, Art und Version erkennen,
   mit vorhandenen Ridern vergleichen und automatisch entscheiden, ob
   etwas neu gespeichert, ersetzt (alte Version archivieren) oder nur
   bestätigt werden muss.
   ====================================================================== */
const Smart = (() => {
  const MAX_TEXT = 150000;

  /* ---------- Hash ---------- */
  async function hashBlob(blob) {
    const buf = await blob.arrayBuffer();
    if (crypto.subtle) {
      const h = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback ohne sicheren Kontext (z. B. http im LAN): FNV-1a
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    const a = new Uint8Array(buf);
    for (let i = 0; i < a.length; i++) { h1 = Math.imul(h1 ^ a[i], 16777619); h2 = Math.imul(h2 ^ a[i], 2246822519); }
    return 'fnv' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + a.length.toString(16);
  }

  /* ---------- Text auslesen ---------- */
  let pdfjs = null;
  async function pdfText(blob) {
    if (!pdfjs) {
      pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
    }
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    const lines = [];
    let title = '';
    try { title = (await pdf.getMetadata())?.info?.Title || ''; } catch { /* egal */ }
    // Zeilen als Zellen mit x-Position sammeln; große Lücken = neue Tabellenzelle
    const HEAD_RE = /(instr|source|quelle|signal)/i, HEAD_RE2 = /(mic|mikro|\bdi\b|ch\b|kanal)/i;
    for (let p = 1; p <= Math.min(pdf.numPages, 40); p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      let cells = [], cell = null, lastY = null, lastEnd = null, headX = null;
      const endCell = () => { if (cell && cell.s.trim()) cells.push({ x: cell.x, e: Math.max(cell.e, cell.x + 1), s: cell.s.replace(/\s+/g, ' ').trim() }); cell = null; };
      const endLine = () => {
        endCell();
        if (!cells.length) { lines.push(''); return; }
        const plain = cells.map((c) => c.s).join(' ');
        if (cells.length >= 3 && HEAD_RE.test(plain) && HEAD_RE2.test(plain)) headX = cells.map((c) => ({ x: c.x, e: c.e }));
        if (headX && cells.length >= 2 && cells.length < headX.length && /^\d/.test(cells[0].s)) {
          // Zellen den Spalten der Kopfzeile zuordnen (größte Überlappung), damit leere Zellen ihren Platz behalten
          const out = Array(headX.length).fill('');
          let prev = -1;
          for (const c of cells) {
            let best = 0, bestGap = Infinity;
            headX.forEach((h, k) => {
              const gap = Math.max(h.x, c.x) - Math.min(h.e, c.e); // < 0 = Überlappung
              if (gap < bestGap) { bestGap = gap; best = k; }
            });
            if (best <= prev) best = Math.min(prev + 1, headX.length - 1);
            prev = best;
            out[best] = out[best] ? out[best] + ' ' + c.s : c.s;
          }
          lines.push(out.join('\t').replace(/\t+$/, ''));
        } else lines.push(cells.map((c) => c.s).join('\t'));
        cells = [];
      };
      for (const it of content.items) {
        if (!('str' in it)) continue;
        const x = it.transform[4], y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) { endLine(); lastEnd = null; }
        const blank = !it.str.trim();
        if (blank) {
          if ((it.width || 0) > 8) endCell(); else if (cell) cell.s += ' ';
        } else {
          if (cell && lastEnd !== null && x - lastEnd > 8) endCell();
          if (!cell) cell = { x, e: x, s: '' };
          else if (lastEnd !== null && x - lastEnd > 1 && !cell.s.endsWith(' ')) cell.s += ' ';
          cell.s += it.str;
          cell.e = x + (it.width || 0);
        }
        lastY = y;
        lastEnd = x + (it.width || 0);
        if (it.hasEOL) { endLine(); lastY = null; lastEnd = null; }
      }
      endLine();
    }
    await pdf.destroy();
    return { text: lines.join('\n'), title };
  }

  // Minimaler ZIP-Leser für .docx / .xlsx / .odt (nutzt DecompressionStream des Browsers)
  async function unzip(blob, wanted) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return {};
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extra + comment;
      if (!wanted(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = buf.subarray(start, start + size);
      if (method === 0) out[name] = dec.decode(data);
      else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out[name] = await new Response(s).text();
      }
    }
    return out;
  }
  const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  async function officeText(blob, name) {
    if (/\.docx$/i.test(name)) {
      const f = await unzip(blob, (n) => n === 'word/document.xml');
      const xml = (f['word/document.xml'] || '').replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, (row) =>
        row.split(/<\/w:tc>/).map((c) => xmlText(c.replace(/<\/w:p>/g, ' ')).replace(/\s+/g, ' ').trim()).filter((c, i, a) => c || i < a.length - 1).join('\t') + '</w:p>');
      return xml.split(/<\/w:p>/).map((par) => xmlText(par.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n'))).join('\n');
    }
    if (/\.odt$/i.test(name)) {
      const f = await unzip(blob, (n) => n === 'content.xml');
      return (f['content.xml'] || '').split(/<\/text:(?:p|h)>/).map(xmlText).join('\n');
    }
    if (/\.xlsx$/i.test(name)) {
      const f = await unzip(blob, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      const shared = (f['xl/sharedStrings.xml'] || '').split(/<\/si>/).map(xmlText);
      const rows = [];
      for (const [n, xml] of Object.entries(f).sort()) {
        if (!n.includes('worksheets')) continue;
        for (const row of xml.split(/<\/row>/)) {
          const cells = [];
          let first = null;
          for (const m of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = m[1] || '', inner = m[2] || '';
            const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
            let val = null;
            if (/t="s"/.test(attrs) && v !== undefined) val = shared[+v] ?? '';
            else if (/t="inlineStr"/.test(attrs)) val = xmlText(inner);
            else if (v !== undefined) val = xmlText(v);
            if (val === null) continue;
            // Spalte aus dem Zellbezug (z. B. r="C3"), damit leere Zellen ihren Platz behalten
            const col = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
            const ci = col ? [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
            if (first === null) first = ci;
            cells[ci - first] = val;
          }
          const arr = Array.from(cells, (c) => c ?? '');
          if (arr.some((c) => c.trim())) rows.push(arr.join(' | '));
        }
      }
      return rows.join('\n');
    }
    return '';
  }

  function kindOf(name, mime) {
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    if (/\.(docx|xlsx|odt)$/i.test(name)) return 'office';
    if (mime?.startsWith('text/') || /\.(txt|csv|tsv|md|rtf)$/i.test(name)) return 'text';
    if (mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(name)) return 'image';
    return 'other';
  }

  async function analyzeBlob(blob, name, mime) {
    const kind = kindOf(name, mime);
    let text = '', title = '';
    try {
      if (kind === 'pdf') ({ text, title } = await pdfText(blob));
      else if (kind === 'office') text = await officeText(blob, name);
      else if (kind === 'text') text = await blob.text();
    } catch (e) { console.warn('Text konnte nicht gelesen werden:', name, e); }
    return { name, mime, size: blob.size, kind, hash: await hashBlob(blob), text: text.slice(0, MAX_TEXT), title };
  }

  /* ---------- Vergleich ---------- */
  const lineKey = (l) => l.toLowerCase().replace(/\s+/g, ' ').trim();
  const linesOf = (t) => String(t || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !/^(seite|page)\s*\d+(\s*(von|of|\/)\s*\d+)?$/i.test(l));

  function diff(oldText, newText) {
    const A = linesOf(oldText), B = linesOf(newText);
    const left = new Map();
    for (const l of A) left.set(lineKey(l), (left.get(lineKey(l)) || 0) + 1);
    const added = [];
    let common = 0;
    for (const l of B) {
      const k = lineKey(l), c = left.get(k) || 0;
      if (c > 0) { left.set(k, c - 1); common++; } else added.push(l);
    }
    const right = new Map();
    for (const l of B) right.set(lineKey(l), (right.get(lineKey(l)) || 0) + 1);
    const removed = [];
    for (const l of A) {
      const k = lineKey(l), c = right.get(k) || 0;
      if (c > 0) right.set(k, c - 1); else removed.push(l);
    }
    const total = A.length + B.length;
    return { added, removed, similarity: total ? (2 * common) / total : 1 };
  }
  const sameText = (a, b) => linesOf(a).length > 0 && linesOf(a).map(lineKey).join('\n') === linesOf(b).map(lineKey).join('\n');

  /* ---------- Erkennung ---------- */
  const simp = (s) => ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

  function detectBand(info, bands, docs) {
    const same = docs.find((d) => d.fileHash && d.fileHash === info.hash);
    if (same) return { bandId: same.bandId, reason: 'gleiche Datei schon abgelegt', strong: true };
    const fS = simp(info.name), fN = norm(info.name);
    const tS = simp(info.title + '\n' + info.text.slice(0, 30000));
    const score = new Map();
    const reason = new Map();
    const add = (id, s, r) => { score.set(id, (score.get(id) || 0) + s); reason.set(id, [...(reason.get(id) || []), r]); };
    for (const b of bands) {
      const bS = simp(b.name).trim(), bN = norm(b.name);
      if (!bN) continue;
      if (fS.includes(' ' + bS + ' ') || (bN.length >= 4 && fN.includes(bN))) add(b.id, 3, 'Dateiname');
      if (bS.length >= 2 && tS.includes(' ' + bS + ' ')) add(b.id, bN.length >= 4 ? 2 : 1, 'Inhalt');
    }
    if (info.text) {
      for (const d of docs) {
        if (!d.text || !d.fileName) continue;
        // Gleiche Vorlage, andere Band? Steht der Bandname im alten Rider, aber nicht im neuen, zählt die Ähnlichkeit nicht.
        const b = bands.find((x) => x.id === d.bandId);
        const bS = b ? simp(b.name).trim() : '';
        if (bS && simp(d.text).includes(' ' + bS + ' ') && !tS.includes(' ' + bS + ' ') && !fS.includes(' ' + bS + ' ') && !fN.includes(norm(b.name))) continue;
        const sim = diff(d.text, info.text).similarity;
        if (sim > 0.45) add(d.bandId, 5 * sim, 'ähnlicher Rider');
      }
    }
    let best = null;
    for (const [id, s] of score) if (!best || s > best.s) best = { id, s };
    if (!best || best.s < 1.5) return { bandId: null };
    return { bandId: best.id, reason: [...new Set(reason.get(best.id))].join(' + '), strong: best.s >= 3 };
  }

  const STOP = new Set(('techrider tech rider riders technical technische technisch inputliste inputlist input inputs list liste channel channellist kanalliste ' +
    'stageplot stage plot buehnenplan buhnenplan buehne buhne hospitality hospi catering monitor monitoring licht light lichtrider lightrider ' +
    'version final neu new aktuell update updated stand kopie copy de en eng ger english deutsch doc pdf scan the and und fur fuer for ' +
    'jan feb mar apr mai may jun jul aug sep okt oct nov dez dec').split(' '));
  function suggestName(info) {
    const words = info.name.replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.+()[\],]+/)
      .filter((w) => w && !STOP.has(norm(w)) && !/^(v|rev)?\d+[a-z]?$/i.test(w) && !/^\d/.test(w));
    if (words.length) return words.join(' ');
    if (info.title && info.title.length < 40 && !STOP.has(norm(info.title))) return info.title;
    const first = linesOf(info.text).find((l) => l.length > 1 && l.length < 40 && !STOP.has(norm(l)));
    return first || '';
  }

  function detectType(info) {
    const n = norm(info.name);
    const byName = [['input', 'Inputliste'], ['channel', 'Inputliste'], ['kanal', 'Inputliste'], ['stageplot', 'Stageplot'], ['buhnen', 'Stageplot'], ['buehnen', 'Stageplot'],
      ['plot', 'Stageplot'], ['monitor', 'Monitoring'], ['licht', 'Lichtrider'], ['light', 'Lichtrider'], ['hospi', 'Hospitality'], ['catering', 'Hospitality'],
      ['techrider', 'Techrider'], ['tech', 'Techrider'], ['rider', 'Techrider']].find(([k]) => n.includes(k));
    if (byName) return byName[1];
    if (info.kind === 'image') return 'Stageplot';
    const t = info.text.toLowerCase();
    if (!t.trim()) return 'Techrider';
    const head = t.slice(0, 400);
    if (/(input ?list|inputliste|kanalbelegung|channel ?list)/.test(head)) return 'Inputliste';
    if (/(stage ?plot|bühnenplan|buehnenplan)/.test(head)) return 'Stageplot';
    if (/(hospitality|catering)/.test(head) && !/tech/.test(head)) return 'Hospitality';
    if (/(licht|lighting|light rider)/.test(head) && !/(ton|sound|audio)/.test(head)) return 'Lichtrider';
    const lines = linesOf(info.text);
    const numbered = lines.filter((l) => /^\d{1,2}[\s.|)]/.test(l)).length;
    const count = (re) => (t.match(re) || []).length;
    const hospi = count(/catering|getränke|getraenke|handtücher|handtuecher|verpflegung|backstage|essen|vegan/g);
    const tech = count(/foh|pa\b|monitor|mikrofon|mic|di-box|\bdi\b|pult|console|xlr|phantom|sm57|sm58/g);
    if (numbered >= 8 && lines.length < numbered * 2.5) return 'Inputliste';
    if (hospi > 3 && hospi > tech) return 'Hospitality';
    return 'Techrider';
  }

  function extractDate(text) {
    const t = String(text || '').slice(0, 8000);
    const fix = (y) => (y.length === 2 ? '20' + y : y);
    const pad = (x) => String(x).padStart(2, '0');
    let m = t.match(/(stand|version|datum|date|updated|aktualisiert|last update)[^0-9\n]{0,20}(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i);
    if (m && +m[3] <= 12) return `${fix(m[4])}-${pad(m[3])}-${pad(m[2])}`;
    m = t.match(/(stand|version|datum|date|updated|aktualisiert)[^0-9\n]{0,20}(\d{1,2})[./](20\d\d)/i);
    if (m && +m[2] <= 12) return `${m[3]}-${pad(m[2])}-01`;
    m = t.match(/(stand|version|datum|date|updated|aktualisiert)[^0-9\n]{0,20}(20\d\d)-(\d\d)-(\d\d)/i);
    if (m) return `${m[2]}-${m[3]}-${m[4]}`;
    return '';
  }

  function extractContact(text) {
    const t = String(text || '');
    const mails = [...new Set(t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])].slice(0, 3);
    const phones = [...new Set((t.match(/(?:\+|0)\d[\d /()-]{6,}\d/g) || []).map((p) => p.trim()))].filter((p) => p.replace(/\D/g, '').length >= 8).slice(0, 2);
    return [...mails, ...phones].join('\n');
  }

  const fileDate = (f) => {
    if (!f.lastModified) return today();
    const d = new Date(f.lastModified);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  // Ältere Unterlagen (vor dieser Funktion abgelegt) einmalig auslesen
  async function indexDocs() {
    for (const d of await DB.all('docs')) {
      if (d.blob && (!d.fileHash || d.text === undefined)) {
        const a = await analyzeBlob(d.blob, d.fileName, d.mime);
        d.fileHash = a.hash;
        d.text = a.text;
        await DB.put('docs', d);
      }
    }
  }

  /* ---------- Entscheidung pro Datei ---------- */
  function compare(item, band, docs) {
    if (!band) return { status: item.bandName.trim() ? 'new-band' : 'no-band' };
    const info = item.info;
    const bandDocs = docs.filter((d) => d.bandId === band.id);
    const ident = bandDocs.find((d) => d.fileHash === info.hash);
    if (ident) return { status: ident.archived ? 'archived-copy' : 'identical', doc: ident };
    const active = bandDocs.filter((d) => !d.archived);
    if (info.text) {
      const same = active.find((d) => d.text && sameText(d.text, info.text));
      if (same) return { status: 'same', doc: same };
      const oldSame = bandDocs.find((d) => d.archived && d.text && sameText(d.text, info.text));
      if (oldSame) return { status: 'archived-copy', doc: oldSame };
    }
    let best = null;
    for (const d of active.filter((x) => x.type === item.type)) {
      const df = d.text && info.text ? diff(d.text, info.text) : null;
      const sim = df ? df.similarity : 0;
      if (!best || sim > best.sim || (sim === best.sim && (d.date || '') > (best.doc.date || ''))) best = { doc: d, sim, df };
    }
    if (!best && info.text) {
      for (const d of active) {
        if (!d.text) continue;
        const df = diff(d.text, info.text);
        if (df.similarity > 0.6 && (!best || df.similarity > best.sim)) best = { doc: d, sim: df.similarity, df };
      }
    }
    if (best && best.df && best.sim < 0.15 && ['Sonstiges', 'Notizen', 'Kontakte'].includes(best.doc.type)) best = null;
    if (best) return { status: 'changed', doc: best.doc, diff: best.df, comparable: !!best.df };
    return { status: 'new' };
  }

  const ACTIONS = {
    replace: 'Neue Version speichern, alte archivieren',
    add: 'Als zusätzliche Unterlage speichern',
    confirm: 'Nicht speichern – vorhandene ist aktuell',
    skip: 'Ignorieren',
  };
  const defaultAction = (s) => ({ identical: 'confirm', same: 'confirm', 'archived-copy': 'skip', changed: 'replace' }[s] || 'add');
  const allowedActions = (s) => (['identical', 'same'].includes(s) ? ['confirm', 'add', 'skip']
    : s === 'changed' ? ['replace', 'add', 'confirm', 'skip']
      : s === 'archived-copy' ? ['skip', 'add'] : ['add', 'skip']);

  /* ---------- Hilfsdialoge ---------- */
  function progress(text) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `<div class="modal center"><div class="spinner"></div><p class="ptext">${esc(text)}</p></div>`;
    document.body.appendChild(el);
    return { update: (t) => ($('.ptext', el).textContent = t), close: () => el.remove() };
  }

  // Dateiauswahl (muss direkt aus einem Klick heraus aufgerufen werden)
  function pickFiles(accept = '') {
    return new Promise((resolve) => {
      const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept, hidden: true });
      document.body.appendChild(inp);
      inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
      inp.click();
    });
  }

  // Kleiner Dialog mit Ablagefeld, z. B. nach "Veraltet"
  async function ask(hint, ctx = {}) {
    const files = await modal(`
      <div class="modal-head"><h2>Rider ablegen</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      <div class="drop" tabindex="0"><div class="drop-text">📄 Dateien hierher ziehen oder <u>auswählen</u><br>
        <span class="muted small">Band, Art und Version werden automatisch erkannt</span></div></div>
      <div class="actions">${ctx.bandId ? '<button class="ghost" data-note>📝 Nur Notiz</button>' : ''}<button class="ghost" data-close>Später</button></div>`, (el, done) => {
      const drop = $('.drop', el);
      drop.onclick = async () => { const f = await pickFiles(); if (f.length) done(f); };
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); done([...e.dataTransfer.files]); };
      const n = $('[data-note]', el);
      if (n) n.onclick = () => done('note');
    });
    if (files === 'note') return noteDialog(ctx);
    if (files?.length) return run(files, ctx);
  }

  /* ---------- Der Import-Dialog ---------- */
  async function run(fileList, ctx = {}) {
    const files = [...fileList].filter((f) => f.size > 0);
    if (!files.length) return;
    const pr = progress(`Analysiere ${files.length === 1 ? files[0].name : files.length + ' Dateien'} …`);
    const infos = [];
    try {
      await indexDocs();
      for (const f of files) { pr.update(`Lese ${f.name} …`); infos.push({ ...(await analyzeBlob(f, f.name, f.type)), file: f }); }
    } finally { pr.close(); }

    const [bands, docs, allConcerts] = await Promise.all([Data.bands(), Data.docs(), Data.concerts()]);
    const concerts = allConcerts.filter((c) => c.kind !== 'festival');
    const bandByName = (n) => bands.find((b) => norm(b.name) === norm(n)) || null;
    const t0 = today();
    const upcoming = concerts.filter((c) => (c.date || '9999') >= t0).sort((a, b) => concertKey(a).localeCompare(concertKey(b)));
    const past = concerts.filter((c) => (c.date || '9999') < t0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);

    const items = infos.map((info) => {
      const det = ctx.bandId ? { bandId: ctx.bandId, reason: '' } : detectBand(info, bands, docs);
      const band = bands.find((b) => b.id === det.bandId);
      det.forName = band?.name || '';
      let warn = '';
      if (ctx.bandId) {
        const other = detectBand(info, bands.filter((b) => b.id !== ctx.bandId), docs.filter((d) => d.bandId !== ctx.bandId));
        if (other.bandId && other.strong) warn = `Achtung: Die Datei sieht nach <b>${esc(bands.find((b) => b.id === other.bandId)?.name)}</b> aus (${other.reason}).`;
      }
      return {
        info, det, warn,
        bandName: band?.name || '',
        type: detectType(info),
        action: null, actionTouched: false,
        concert: ctx.concertId || '', concertTouched: !!ctx.concertId,
        nc: { title: '', date: '', venue: '' },
        genre: '', contact: extractContact(info.text),
        date: extractDate(info.text) || fileDate(info.file),
      };
    });
    // Unerkannte Dateien aus demselben Upload gehören meist zur selben Band
    const found = [...new Set(items.filter((i) => i.bandName).map((i) => i.bandName))];
    items.forEach((i) => {
      if (i.bandName) return;
      if (found.length === 1) { i.bandName = found[0]; i.det = { reason: 'gleicher Upload wie die anderen Dateien', forName: found[0] }; } else i.bandName = suggestName(i.info);
    });

    const concertOptions = (sel, shared) => `
      <option value="">– kein Konzert –</option>
      ${upcoming.length ? `<optgroup label="Anstehend">${upcoming.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${c.date ? fmtDate(c.date) + ' – ' : ''}${esc(c.title)}</option>`).join('')}</optgroup>` : ''}
      ${past.length ? `<optgroup label="Vergangen">${past.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${fmtDate(c.date)} – ${esc(c.title)}</option>`).join('')}</optgroup>` : ''}
      ${shared ? `<option value="__shared" ${sel === '__shared' ? 'selected' : ''}>→ neues Konzert (oben)</option>` : ''}
      <option value="__new" ${sel === '__new' ? 'selected' : ''}>+ Neues Konzert …</option>`;
    const ncFields = (pfx, nc) => `
      <div class="nc">
        <input data-${pfx}="title" placeholder="Name des Konzerts" value="${esc(nc.title)}">
        <div class="row2"><input type="date" data-${pfx}="date" value="${esc(nc.date || t0)}"><input data-${pfx}="venue" placeholder="Ort / Venue" value="${esc(nc.venue)}"></div>
      </div>`;
    const kindLabel = { pdf: 'PDF', office: 'Office', text: 'Text', image: 'Bild', other: 'Datei' };
    const multi = items.length > 1;
    const shared = { concert: ctx.concertId || '', nc: { title: '', date: '', venue: '' } };

    const result = await modal(`
      <div class="modal-head"><div><span class="badge accent">Automatisch erkannt</span><h2>${items.length === 1 ? '1 Datei' : items.length + ' Dateien'} prüfen</h2></div>
        <button class="icon" data-close aria-label="Schließen">✕</button></div>
      ${multi ? `<div class="card shared-concert"><label class="lbl">Alle einem Konzert zuordnen
        <select data-shared>${concertOptions(shared.concert)}</select></label><div class="shared-nc" hidden>${ncFields('snc', shared.nc)}</div></div>` : ''}
      <datalist id="dl-imp">${bands.sort(byName).map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      <div class="imp-list">${items.map((it, i) => `
        <div class="imp card" data-i="${i}">
          <div class="imp-file">📄 <b>${esc(it.info.name)}</b> <span class="muted small">${kindLabel[it.info.kind]} · ${fmtSize(it.info.size)}${it.info.text ? '' : it.info.kind === 'image' ? ' · Bild: Vergleich nur über Dateiinhalt' : ' · kein Text lesbar'}</span></div>
          ${it.warn ? `<p class="warn-text small">${it.warn}</p>` : ''}
          <div class="row2">
            <label class="lbl">Band <input data-f="band" list="dl-imp" value="${esc(it.bandName)}" placeholder="Wie heißt die Band?" autocomplete="off">
              <span class="det small"></span></label>
            <label class="lbl">Art <select data-f="type">${DOC_TYPES.map((t) => `<option ${t === it.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          </div>
          <div class="newband" hidden>
            <p class="small"><b>Neue Band</b> – stimmt der Name? Ein paar Infos helfen später:</p>
            <div class="row2"><input data-f="genre" placeholder="Genre / Besetzung"><textarea data-f="contact" rows="2" placeholder="Kontakt">${esc(it.contact)}</textarea></div>
          </div>
          <div class="status"></div>
          <div class="row2">
            <label class="lbl">Was soll passieren? <select data-f="action"></select></label>
            <label class="lbl">Stand <input type="date" data-f="date" value="${esc(it.date)}"></label>
          </div>
          <label class="lbl">Konzert <select data-f="concert">${concertOptions(it.concert, multi)}</select></label>
          <div class="item-nc" hidden>${ncFields('nc', it.nc)}</div>
        </div>`).join('')}</div>
      <p class="error" hidden></p>
      <div class="actions sticky-actions"><button class="ghost" data-close>Abbrechen</button><button class="primary" data-ok>Übernehmen</button></div>`,
    (el, done) => {
      el.classList.add('wide');
      const cards = $$('.imp', el);

      const update = (i) => {
        const it = items[i], card = cards[i];
        const band = bandByName(it.bandName);
        it.cmp = compare(it, band, docs);
        const s = it.cmp.status, d = it.cmp.doc;
        // Erkennungshinweis
        $('.det', card).innerHTML = band
          ? (it.det.reason && norm(it.det.forName) === norm(band.name) ? `✓ erkannt: ${esc(it.det.reason)}` : '✓ bekannte Band')
          : it.bandName.trim() ? '<span class="badge">neu</span> wird angelegt' : '';
        $('.newband', card).hidden = !(s === 'new-band');
        // Status
        const ref = d ? `„${esc(d.title)}“${d.date ? ' (Stand ' + fmtDate(d.date) + ')' : ''}` : '';
        const replIn = d && s === 'changed' ? upcoming.filter((c) => c.lineup.some((e) => e.docIds.includes(d.id))).map((c) => esc(c.title)) : [];
        let html = '';
        if (s === 'identical') html = `<div class="st ok">✓ <b>Identisch</b> mit ${ref}. Der Rider ist aktuell – er wird nicht erneut gespeichert.</div>`;
        else if (s === 'same') html = `<div class="st ok">✓ <b>Inhaltlich unverändert</b> gegenüber ${ref} (nur neu exportiert). Wird nicht erneut gespeichert.</div>`;
        else if (s === 'archived-copy') html = `<div class="st warn">⚠ Das ist eine <b>ältere Version</b> (${ref}), die bereits archiviert ist.</div>`;
        else if (s === 'changed') {
          const df = it.cmp.diff;
          html = `<div class="st change">↻ <b>Geändert</b> gegenüber ${ref}${df ? `: <span class="plus">+${df.added.length}</span> / <span class="minus">−${df.removed.length}</span> Zeilen (${Math.round(df.similarity * 100)} % gleich)` : ' – Datei unterscheidet sich'}.
            Die alte Version wird archiviert.${replIn.length ? `<br>Wird auch in <b>${replIn.join(', ')}</b> ersetzt.` : ''}
            ${df && (df.added.length || df.removed.length) ? `<details><summary>Änderungen ansehen</summary><ul class="difflist">
              ${df.removed.slice(0, 25).map((l) => `<li class="minus">− ${esc(l)}</li>`).join('')}
              ${df.added.slice(0, 25).map((l) => `<li class="plus">+ ${esc(l)}</li>`).join('')}
              ${df.added.length + df.removed.length > 50 ? '<li class="muted">…</li>' : ''}</ul></details>` : ''}</div>`;
        } else if (s === 'new') html = `<div class="st new">＋ <b>Neue Unterlage</b> für ${esc(band.name)} – bisher gibt es keine ${esc(it.type)}-Datei.</div>`;
        else if (s === 'new-band') html = `<div class="st new">★ <b>Neue Band.</b> Bitte Namen prüfen und das Konzert wählen.</div>`;
        else html = '<div class="st warn">Wie heißt die Band?</div>';
        $('.status', card).innerHTML = html;
        // Aktion
        const allowed = allowedActions(s);
        if (!it.actionTouched || !allowed.includes(it.action)) it.action = defaultAction(s);
        $('[data-f=action]', card).innerHTML = allowed.map((a) => `<option value="${a}" ${a === it.action ? 'selected' : ''}>${ACTIONS[a]}</option>`).join('');
        card.classList.toggle('skipped', it.action === 'skip');
        // Konzert vorschlagen: nächstes anstehendes Konzert, in dem die Band spielt
        if (!it.concertTouched && band) {
          const c = upcoming.find((x) => x.lineup.some((e) => e.bandId === band.id));
          if (c) { it.concert = c.id; $('[data-f=concert]', card).value = c.id; }
        }
        $('.item-nc', card).hidden = it.concert !== '__new';
        $('[data-f=concert]', card).classList.toggle('attention', s === 'new-band' && !it.concert);
      };

      cards.forEach((card, i) => {
        const it = items[i];
        const f = (n) => $(`[data-f=${n}]`, card);
        f('band').oninput = () => { it.bandName = f('band').value; update(i); };
        f('type').onchange = () => { it.type = f('type').value; update(i); };
        f('action').onchange = () => { it.action = f('action').value; it.actionTouched = true; card.classList.toggle('skipped', it.action === 'skip'); };
        f('date').onchange = () => { it.date = f('date').value; };
        f('genre').oninput = () => { it.genre = f('genre').value; };
        f('contact').oninput = () => { it.contact = f('contact').value; };
        f('concert').onchange = () => {
          it.concert = f('concert').value; it.concertTouched = true;
          if (it.concert === '__new' && !it.nc.title) { it.nc.title = it.bandName; $('[data-nc=title]', card).value = it.bandName; }
          update(i);
        };
        $$('[data-nc]', card).forEach((inp) => (inp.oninput = () => { it.nc[inp.dataset.nc] = inp.value; }));
        update(i);
      });

      const sh = $('[data-shared]', el);
      if (sh) {
        sh.onchange = () => {
          shared.concert = sh.value;
          $('.shared-nc', el).hidden = sh.value !== '__new';
          const v = sh.value === '__new' ? '__shared' : sh.value;
          items.forEach((it, i) => { it.concert = v; it.concertTouched = true; $('[data-f=concert]', cards[i]).value = v; update(i); });
        };
        $$('[data-snc]', el).forEach((inp) => (inp.oninput = () => { shared.nc[inp.dataset.snc] = inp.value; }));
      }

      $('[data-ok]', el).onclick = () => {
        const err = $('.error', el);
        const bad = items.findIndex((it) => it.action !== 'skip' && !it.bandName.trim());
        if (bad >= 0) { err.textContent = `Bitte bei „${items[bad].info.name}“ den Bandnamen angeben.`; err.hidden = false; cards[bad].scrollIntoView({ block: 'center' }); return; }
        done(true);
      };
    });
    if (!result) return null;
    return apply(items, shared, ctx);
  }

  async function apply(items, shared, ctx) {
    const t0 = today();
    const bandCache = new Map();
    const newConcerts = new Map();
    const stats = { saved: 0, replaced: 0, confirmed: 0, skipped: 0, bands: 0, concerts: new Set() };
    const touchedBands = new Set();

    const getBand = async (it) => {
      const key = norm(it.bandName);
      if (bandCache.has(key)) return bandCache.get(key);
      const { band, created } = await Data.findOrCreateBand(it.bandName);
      if (created) {
        stats.bands++;
        if (it.genre || it.contact) { band.genre = it.genre.trim(); band.contact = it.contact.trim(); await DB.put('bands', band); }
      }
      bandCache.set(key, band);
      return band;
    };
    const getConcert = async (it) => {
      let sel = it.concert, nc = it.nc;
      if (sel === '__shared') { sel = '__new'; nc = shared.nc; }
      if (!sel) return null;
      if (sel !== '__new') return sel;
      const title = (nc.title || it.bandName).trim();
      const key = norm(title) + '|' + (nc.date || t0);
      if (!newConcerts.has(key)) {
        const c = { id: uid(), title, date: nc.date || t0, venue: (nc.venue || '').trim(), notes: '', lineup: [], createdAt: nowIso() };
        await DB.put('concerts', c);
        newConcerts.set(key, c.id);
      }
      return newConcerts.get(key);
    };
    const attach = async (concertId, bandId, docId, replaceId = null) => {
      const c = await DB.get('concerts', concertId);
      if (!c) return;
      let e = c.lineup.find((x) => x.bandId === bandId);
      if (!e) { e = { bandId, time: '', docIds: [] }; c.lineup.push(e); }
      if (replaceId) e.docIds = e.docIds.filter((x) => x !== replaceId);
      if (!e.docIds.includes(docId)) e.docIds.push(docId);
      await DB.put('concerts', c);
      stats.concerts.add(concertId);
    };

    for (const it of items) {
      if (it.action === 'skip') { stats.skipped++; continue; }
      const band = await getBand(it);
      touchedBands.add(band.id);
      const concertId = await getConcert(it);
      const old = it.cmp.doc ? await DB.get('docs', it.cmp.doc.id) : null;

      if (it.action === 'confirm' && old) {
        old.confirmedAt = nowIso();
        await DB.put('docs', old);
        stats.confirmed++;
        if (concertId) await attach(concertId, band.id, old.id);
        continue;
      }
      const f = it.info.file;
      const doc = {
        id: uid(), bandId: band.id, type: it.type, title: f.name.replace(/\.[^.]+$/, ''),
        date: it.date || t0, notes: '', archived: false, confirmedAt: nowIso(), createdAt: nowIso(),
        fileName: f.name, mime: f.type || '', size: f.size, blob: f, fileHash: it.info.hash, text: it.info.text,
        replaces: it.action === 'replace' && old ? old.id : undefined,
      };
      await DB.put('docs', doc);
      stats.saved++;
      if (it.action === 'replace' && old) {
        old.archived = true;
        await DB.put('docs', old);
        stats.replaced++;
        // In allen anstehenden Konzerten die neue Version einsetzen
        for (const c of await Data.concerts()) {
          if ((c.date || '9999') < t0) continue;
          const e = c.lineup.find((x) => x.docIds.includes(old.id));
          if (e) { e.docIds = e.docIds.map((x) => (x === old.id ? doc.id : x)); await DB.put('concerts', c); stats.concerts.add(c.id); }
        }
      }
      if (concertId) await attach(concertId, band.id, doc.id, it.action === 'replace' && old ? old.id : null);
    }

    const parts = [];
    if (stats.saved - stats.replaced) parts.push(`${stats.saved - stats.replaced} neu gespeichert`);
    if (stats.replaced) parts.push(`${stats.replaced} aktualisiert (alte Version archiviert)`);
    if (stats.confirmed) parts.push(`${stats.confirmed} war${stats.confirmed > 1 ? 'en' : ''} schon aktuell`);
    if (stats.bands) parts.push(`${stats.bands} neue Band${stats.bands > 1 ? 's' : ''}`);
    toast(parts.join(' · ') || 'Nichts geändert');

    // Sinnvoll weiter navigieren
    if (!ctx.bandId && !ctx.concertId) {
      if (stats.concerts.size === 1) location.hash = '#/concert/' + [...stats.concerts][0];
      else if (touchedBands.size === 1) location.hash = '#/band/' + [...touchedBands][0];
    }
    await render();
    return stats;
  }

  /* ---------- Reine Notiz (ohne Datei) ---------- */
  async function noteDialog(ctx = {}) {
    const res = await modal(`
      <div class="modal-head"><h2>Notiz ablegen</h2><button class="icon" data-close aria-label="Schließen">✕</button></div>
      <form class="form">
        <label>Art <select name="type">${DOC_TYPES.map((t) => `<option ${t === 'Notizen' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Titel <input name="title" placeholder="z. B. Absprache Monitoring" autofocus></label>
        <label>Notiz <textarea name="notes" rows="5" required></textarea></label>
        <div class="actions"><button type="button" class="ghost" data-close>Abbrechen</button><button class="primary">Speichern</button></div>
      </form>`, (el, done) => {
      $('form', el).onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.notes.value.trim()) return;
        done({ type: f.type.value, title: f.title.value.trim() || f.type.value, notes: f.notes.value.trim() });
      };
    });
    if (!res) return;
    const doc = { id: uid(), bandId: ctx.bandId, ...res, date: today(), archived: false, confirmedAt: nowIso(), createdAt: nowIso(), fileName: '', mime: '', size: 0, blob: null, text: res.notes };
    await DB.put('docs', doc);
    if (ctx.concertId) {
      const c = await DB.get('concerts', ctx.concertId);
      const e = c?.lineup.find((x) => x.bandId === ctx.bandId);
      if (e) { e.docIds.push(doc.id); await DB.put('concerts', c); }
    }
    toast('Notiz gespeichert');
    render();
  }

  return { run, ask, pickFiles, noteDialog, progress, analyzeBlob, diff, detectType, suggestName };
})();
