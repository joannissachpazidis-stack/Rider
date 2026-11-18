'use strict';
/* ======================================================================
   Venue: liest aus Location-Ridern (Hausrider, Technik-Infos, Bühnenpläne)
   die wichtigsten Eckdaten heraus – Kapazität, Raum, Bühne, PA, Monitoring,
   Pulte, Stagebox, Bühnenanbindung, Strom, Licht, Lautstärke usw.
   Reine Textlogik ohne Oberfläche (auch in Node testbar).
   ====================================================================== */
const Venue = (() => {
  const clean = (s) => String(s || '').replace(/[ \s]+/g, ' ').trim();
  const num = (s) => parseFloat(String(s).replace(',', '.'));
  const fmtNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const cap = (s, n = 110) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + ' …' : s);

  /* ---------- Text in Zeilen mit Abschnitts-Kontext zerlegen ---------- */
  function linesOf(docs) {
    const out = [];
    for (const d of docs) {
      let section = '';
      const raw = String(d.text || '').replace(/\t+/g, ' · ');
      for (const rawLine of raw.split(/\r?\n/)) {
        const l = clean(rawLine);
        if (!l) continue;
        const words = l.split(' ').length;
        // Überschrift: kurz und mit ":" am Ende – oder kurz und ganz in Großbuchstaben (z. B. "PA", "MONITORING")
        const heading = (/:$/.test(l) && words <= 5) || (words <= 3 && l.length <= 32 && l === l.toUpperCase() && /[A-ZÄÖÜ]{2}/.test(l));
        if (heading) { section = l.replace(/[:\s]+$/, ''); continue; }
        // Zeile in Abschnitte teilen ("Saal 300 m², Bühne 8 x 6 m; PA: …")
        const safe = l.replace(/\b(ca|z|u|d|o|tel|nr|str|inkl|max|min|bzw|evtl|ggf|usw|etc|approx|incl|stk|ggü|vgl)\.(?=\s)/gi, '$1\u2024');
        const segs = safe.split(/\s*[;|•·]\s*|,\s+(?=[A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöü&\s-]{1,25}:)|(?<=[.!?])\s+(?=[A-ZÄÖÜ])/)
          .map((x) => clean(x.replace(/\u2024/g, '.'))).filter((x) => x.length > 1);
        for (const s of segs) out.push({ text: s, line: l, section, ctx: (section ? section + ': ' : '') + s });
      }
    }
    return out;
  }
  // "Label: Wert" → "Wert"
  const valueOf = (s) => { const m = s.match(/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .\/&()+-]{0,38}:\s*(.+)$/); return clean(m ? m[1] : s).replace(/[.;,]+$/, ''); };

  /* ---------- Bausteine ---------- */
  const SPEAKER = /\b(d\s?&\s?b(?:\s*audiotechnik)?|L-?Acoustics|Meyer(?:\s*Sound)?|Martin\s*Audio|RCF|HK\s*Audio|Kling\s*(?:&|und)\s*Freitag|K&F|Electro-?Voice|EV|JBL|Nexo|Coda(?:\s*Audio)?|Fohhn|Seeburg|dB\s*Technologies|QSC|Turbosound|Alcons|Outline|Funktion[- ]?One|Adamson|Void|Danley|Bose|Mackie|FBT|Dynacord|LD\s*Systems|KS\s*Audio|Cohedra|Tannoy|Community|Renkus[- ]?Heinz|Clair|Opus|Pan\s*Acoustics|Lambda\s*Labs|Yamaha|Genelec)\b/i;
  // Hersteller + bis zu 3 Modell-Bausteine, optional mit Stückzahl davor ("4x d&b V8")
  const MODEL_AFTER = String.raw`(?:[\s-]*(?:[A-Za-z]{0,4}\d[\w./-]*|[A-Z]{2,6}\b|[A-Z]-?Serie\b|[A-Z]-?Series\b|HiQ\b|SUB\b|Sub\b))`;
  const speakerRe = () => new RegExp(String.raw`(?:(\d{1,2})\s*[x×]\s*)?` + SPEAKER.source + `(${MODEL_AFTER}{0,3})`, 'gi');

  const M2 = String.raw`\s+(?:[A-Z0-9][\w-]*\d[\w-]*|Producer|Compact|Rack|Full|Core|Solo|Pro|Light|Expression|Impact|Performer|XT)\b`;
  const CONSOLE = new RegExp(String.raw`\b(Yamaha\s*(?:CL\s?[135]|QL\s?[15]|TF\s?[135]?|DM\s?[37](?:\s*Compact)?|PM\s?\d+\w*|Rivage\s*\w*|LS9(?:-\d+)?|M7CL(?:-\d+)?|01V\s?\w*)|(?:CL\s?[135]|QL\s?[15]|TF\s?[135]|DM\s?[37]|LS9|M7CL)\b|Allen\s*(?:&|und)\s*Heath\s*\w+(?:${M2})?|A\s?&\s?H\s*\w+|dLive\s*\w*|Avantis(?:\s*Solo)?|SQ[-\s]?[567]\b|GLD[-\s]?\d+|Qu[-\s]?\d+|DiGiCo\s*\w+(?:${M2})?|SD\s?(?:5|7|8|9|10|11|12)(?:-?(?:T|B|EX|96)\b)?|Quantum\s*\d+\w*|Midas\s*(?:Pro\s*\w+|M32\w*|Heritage[-\s]?D?\s*\w*|HD96\w*|PRO\d+)|M32\w*|Behringer\s*(?:X32\w*|Wing\w*)|X32(?:${M2})?|\bWing\b(?:${M2})?|Soundcraft\s*\w+(?:${M2})?|Vi\s?\d{1,4}\b|Si\s?(?:Expression|Impact|Performer)\s*\d*|SSL\s*(?:Live\s*)?L?\d*\w*|Avid\s*(?:S6L|Venue|Profile|SC48)\s*\w*|S6L[-\s]?\w*|Venue\s*Profile|Lawo\s*\w+|Studer\s*\w+|Presonus\s*StudioLive\s*\w*|StudioLive\s*\w*)`.replace(/\$\{M2\}/g, M2), 'gi');
  const STAGEBOX = /(?:\b\d{1,2}\s*[x×]\s*)?\b(Rio\s?\d{4}(?:-?D2?)?|Tio\s?\d{4}(?:-?D)?|Ri8(?:-?D)?|Ro8(?:-?D)?|DX\s?168|DX\s?32|DT\s?16[48](?:-?W)?|GX\s?4816|AR\s?2412|AR\s?84|AB\s?168|CDM\s?\d{2}|DM\s?(?:32|48|64)\b|SD[- ]?(?:Mini|Nano)?[- ]?Rack|D2[- ]?Rack|DL\s?\d{2,3}\b|S16\b|S32\b|SD8\b|SD16\b|Stage\s?(?:16|32|64)\b|SB\s?\d{2}\.\d{2}|ML\s?32:32|Stage\s?rack|MixRack\s*\w*|I\/O[- ]?Rack)/gi;
  const IEM = /\b((?:\d{1,2}\s*[x×]\s*)?(?:Sennheiser\s*(?:EW|ew|SR|2000|G[34]|IEM)[\w\s-]{0,12}|Shure\s*PSM\s?\d{3,4}|PSM\s?\d{3,4}|Wisycom\s*\w+|Lectrosonics\s*\w+|Sennheiser\s*\w+))/gi;
  const MICS = /\b((?:\d{1,2}\s*[x×]\s*)?(?:SM\s?5[78]|Beta\s?\d{2}A?|e\s?6\d{2}|e\s?9\d{2}|MD\s?4[24]1|i5|D\s?112|D6\b|C\s?414|KM\s?18\d|Neumann\s*\w+|AKG\s*\w+|Shure\s*(?:ULX|QLX|SLX|Axient|UR)[\w-]*|Sennheiser\s*(?:EW|ew)[\w\s-]{0,10}|BSS\s*AR\s?133|Radial\s*\w+|Klark\s*\w+|DI-?Box(?:en)?))/gi;
  const LIGHTDESK = /\b(grand\s?MA\s?[23](?:\s*\w+)?|MA\s?[23]\s*(?:light|command|compact|onPC|\w+)?|ChamSys\s*\w*|MagicQ\s*\w*|Avolites\s*\w*|Hog\s?4\w*|Zero\s?88\s*\w*|ETC\s*\w+|Jands\s*\w+|Daslight|Lightkey|SoundSwitch)/gi;

  const NEG = /\b(kein(?:e|en)?|nicht\s+vorhanden|nicht\s+verfügbar|ohne|no|none|not\s+available|n\/a|(?:bitte\s+)?(?:selbst\s+)?mitbringen|mitzubringen|must\s+be\s+provided|bring\s+your\s+own)\b/i;

  const allMatches = (re, s) => [...String(s).matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  const normModel = (s) => clean(s).replace(/^(\d+)\s*[x×]\s*/, '$1× ').replace(/\s+(?:wedges?|monitore?|boxen|subs?|tops?)$/i, '').replace(/\s+/g, ' ').replace(/[,.;:(-]+$/, '').replace(/\baudiotechnik\s*/i, '');

  // Hersteller/Modelle in Zeilen finden, nach Häufigkeit; Stückzahlen bleiben dran
  function models(lines, re, max = 4) {
    const found = [];
    for (const l of lines) for (const m of allMatches(re, l.text)) found.push(normModel(m[0]));
    // Doppelte (auch "CL5" vs. "Yamaha CL5") zusammenfassen – die längere Schreibweise gewinnt
    const out = [];
    for (const f of found.sort((a, b) => b.length - a.length)) {
      const k = f.toLowerCase().replace(/^\d+×\s*/, '').replace(/[^a-z0-9]/g, '');
      if (k.length < 2 || out.some((o) => o.k.includes(k))) continue;
      out.push({ k, v: f });
    }
    // Reihenfolge wie im Rider
    return out.sort((a, b) => found.indexOf(a.v) - found.indexOf(b.v)).slice(0, max).map((o) => o.v);
  }
  // Nur echte Modell-Bausteine behalten (Ziffer, Versalien, Serie, HiQ, SUB) – die Suche selbst ignoriert Groß/klein
  const modelPart = (raw) => {
    const keep = [];
    for (const t of clean(raw).split(/\s+/)) {
      if (/\d/.test(t) || /^[A-Z]{2,6}$/.test(t) || /^[A-Z]-?Serie?s?$/.test(t) || /^(?:HiQ|SUB|Sub)$/.test(t)) keep.push(t); else break;
    }
    return keep.join(' ');
  };
  const COUNT_MODEL = /(?<![\w.])(\d{1,2})\s*[x×]\s*([A-Z][A-Za-z]{0,6}[- ]?\d[\w.-]*|[A-Z]-?SUB\w*|[A-Z]{2,6}\d[\w.-]*)/g;
  const AMP_MODEL = /^(?:D\d{2}|LA\d{1,2}D?|PLM\w*|LM\s?\d+)$/i;
  function speakers(lines, max = 4) {
    const found = [];
    for (const l of lines) {
      const brands = [...l.text.matchAll(speakerRe())].map((m) => { m[3] = modelPart(m[3] || ''); return m; }).filter((m) => {
        const model = m[3];
        if (AMP_MODEL.test(model)) return false;
        return model || /d\s?&\s?b|L-?Acoustics|Meyer|Martin|Nexo|Coda|Kling|Alcons|Adamson|Outline|Funktion|RCF|HK|Fohhn|JBL|EV|Electro|Seeburg|dB\s*Tech/i.test(m[2]);
      });
      if (!brands.length) continue;
      const counts = [...l.text.matchAll(COUNT_MODEL)].filter((c) => !brands.some((b) => c.index >= b.index && c.index < b.index + b[0].length) && !AMP_MODEL.test(c[2]))
        .map((c) => `${c[1]}× ${clean(c[2])}`);
      brands.forEach((m, i) => {
        const model = clean(m[3] || '');
        const head = normModel((m[1] ? m[1] + '× ' : '') + clean(m[2]) + (model ? ' ' + model : ''));
        found.push(i === 0 && counts.length ? `${head}: ${counts.slice(0, 4).join(', ')}` : head);
      });
    }
    return uniq(found).slice(0, max);
  }
  const quotes = (lines) => uniq(lines.map((l) => l.line)).slice(0, 4);
  const firstValue = (lines) => (lines.length ? cap(valueOf(lines[0].text)) : '');

  /* ---------- Die einzelnen Angaben ---------- */
  const FIELDS = [];
  const field = (key, icon, title, chip, fn) => FIELDS.push({ key, icon, title, chip, fn });

  // Kapazität
  field('pax', '👥', 'Kapazität', true, (L) => {
    const KEY = /kapazit|capacity|fassungsverm|zugelassen|zulässig|max(?:imal|\.)?\s*(?:pax|personen|besucher|auslastung)|\bpax\b|stehpl|sitzpl|standing|seated|besucherzahl|zuschauer/i;
    const NOT = /crew|catering|gästeliste|guest ?list|backstage|hotel|zimmer|essen|meals?|band(?:mitglieder)?\b|garderobe|parkpl/i;
    const UNIT = /(\d{1,3}(?:[.\s]\d{3})+|\d{2,5})\s*\+?\s*(pax|personen|pers\.?|besucher(?:innen)?|gäste|zuschauer(?:innen)?|people|persons|guests|visitors|stehpl(?:ätze|aetze|atz)?|sitzpl(?:ätze|aetze|atz)?|standing|seated|seats|stehend|sitzend|bestuhlt|unbestuhlt)\b/gi;
    const hits = [], used = [];
    for (const l of L) {
      if (NOT.test(l.text) || !(KEY.test(l.ctx) || /pax|besucher|zuschauer|stehpl|sitzpl|standing|seated/i.test(l.text))) continue;
      let any = false;
      for (const m of l.text.matchAll(UNIT)) {
        const n = parseInt(m[1].replace(/[.\s]/g, ''), 10);
        if (n < 20 || n > 200000) continue;
        const near = m[2] + ' ' + l.text.slice(m.index + m[0].length, m.index + m[0].length + 14);
        const kind = /unbestuhl|steh|stand/i.test(near) ? 'stehend' : /sitz|seat|bestuhl/i.test(near) ? 'sitzend' : '';
        hits.push({ n, kind }); any = true;
      }
      if (!any && KEY.test(l.ctx)) {
        const m = l.text.match(/(?:kapazit\w*|capacity|pax|besucher\w*|personen|zuschauer\w*|zugelassen\w*)\D{0,20}?(\d{1,3}(?:[.\s]\d{3})+|\d{2,5})(?!\s*(?:m\b|m²|qm|€|eur|uhr|:|\.\d))/i);
        if (m) { const n = parseInt(m[1].replace(/[.\s]/g, ''), 10); if (n >= 20 && n <= 200000 && !(n >= 1990 && n <= 2099)) { hits.push({ n, kind: /sitz|seat|bestuhl/i.test(l.text) ? 'sitzend' : /steh|stand/i.test(l.text) ? 'stehend' : '' }); any = true; } }
      }
      if (any) used.push(l);
    }
    if (!hits.length) return null;
    const best = (k) => Math.max(0, ...hits.filter((h) => h.kind === k).map((h) => h.n));
    const parts = [];
    const max = Math.max(...hits.map((h) => h.n));
    const st = best('stehend'), si = best('sitzend');
    if (st || si) { if (st) parts.push(`${st} stehend`); if (si) parts.push(`${si} sitzend`); if (max > Math.max(st, si)) parts.unshift(`max. ${max} Pax`); }
    else parts.push(`max. ${max} Pax`);
    return { value: parts.join(' · '), chip: `${max} Pax`, lines: used };
  });

  const AREA = /(\d+(?:[.,]\d+)?)\s*(m²|m2\b|qm\b|quadratmeter|sqm|square\s*met(?:er|re)s?)/i;
  const DIM = /(\d+(?:[.,]\d+)?)\s*(?:m\s*)?[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*(?:m\s*)?[x×*]\s*(\d+(?:[.,]\d+)?))?\s*(m\b|meter|metres?|mtr\.?)?/i;
  const STAGE_KEY = /bühne|buehne|stage|podest|podium|riser/i;
  const STAGE_NOT = /stage\s?box|stage\s?rack|stage\s?plot|stage\s?plan|bühnenplan|stage\s?hand|stage\s?manag|stage\s?left|stage\s?right|on\s?stage|auf der bühne|bühnenanbindung|bühnenanweisung|bühnenrand|stagetec|stage\s?(?:16|32|64)\b|bühnenstrom|bühnenlicht|bühnenmonitor/i;
  const metres = (s, unitHint) => { const n = num(s); return /cm/i.test(unitHint || '') ? n / 100 : n; };
  const dimText = (m) => [m[1], m[2], m[3]].filter(Boolean).map((x) => fmtNum(num(x))).join(' × ') + ' m';

  // Raumgröße
  field('room', '📐', 'Raum', true, (L) => {
    const KEY = /saal|raum|halle|fläche|grundfläche|club|venue|location|hall\b|room|area|zuschauerraum|publikumsbereich|innenraum|floor|clubraum|tanzfläche/i;
    const used = []; let area = '', dims = '', height = '';
    for (const l of L) {
      if ((STAGE_KEY.test(l.text) && !STAGE_NOT.test(l.text)) || !KEY.test(l.ctx) || /backstage|garderobe|lager|büro|catering/i.test(l.text)) continue;
      const a = l.text.match(AREA), d = l.text.match(DIM);
      const h = l.text.match(/(?:(?:raum|decken|hallen|saal)h(?:ö|oe)he|ceiling(?:\s*height)?)\D{0,12}(\d+(?:[.,]\d+)?)\s*m(?![²2\w])/i);
      if (a && !area) { area = `${fmtNum(num(a[1]))} m²`; used.push(l); }
      if (d && !dims && (d[4] || /m\b/.test(l.text))) { dims = dimText(d); if (!used.includes(l)) used.push(l); }
      if (h && !height) { height = `Höhe ${fmtNum(num(h[1]))} m`; if (!used.includes(l)) used.push(l); }
    }
    if (!area && !dims) return null;
    return { value: [area, dims, height].filter(Boolean).join(' · '), chip: area || dims, lines: used };
  });

  // Bühne
  field('stage', '🎭', 'Bühne', true, (L) => {
    const used = []; let dims = '', area = '', w = '', dpt = '', hgt = '', clear = '';
    for (const l of L) {
      if (!STAGE_KEY.test(l.ctx) || STAGE_NOT.test(l.text)) continue;
      const t = l.text;
      let hit = false;
      const d = t.match(DIM);
      if (d && !dims && (d[4] || /\bm\b|meter/i.test(t)) && !/cm/i.test(t.slice(d.index, d.index + d[0].length + 3))) { dims = dimText(d); hit = true; }
      const a = t.match(AREA); if (a && !area) { area = `${fmtNum(num(a[1]))} m²`; hit = true; }
      const mw = t.match(/(?:breite|width|\bb)\s*[:=]?\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(m|cm)\b/i); if (mw && !w) { w = fmtNum(metres(mw[1], mw[2])); hit = true; }
      const md = t.match(/(?:tiefe|depth|\bt)\s*[:=]?\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(m|cm)\b/i); if (md && !dpt) { dpt = fmtNum(metres(md[1], md[2])); hit = true; }
      const mc = t.match(/(?:lichte\s*h(?:ö|oe)he|clearance|deckenh(?:ö|oe)he|hängeh(?:ö|oe)he|trim\s*height|max\.?\s*höhe\s*über)\D{0,25}(\d+(?:[.,]\d+)?)\s*(m|cm)\b/i); if (mc && !clear) { clear = `lichte Höhe ${fmtNum(metres(mc[1], mc[2]))} m`; hit = true; }
      const mh = !mc && t.match(/(?:bühnenh(?:ö|oe)he|stage\s*height|podest|podium|h(?:ö|oe)he|height|\bh)\s*[:=]?\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(m|cm)\b/i); if (mh && !hgt) { hgt = `Höhe ${fmtNum(metres(mh[1], mh[2]))} m`; hit = true; }
      if (hit) used.push(l);
    }
    if (!dims && w && dpt) dims = `${w} × ${dpt} m`;
    else if (!dims && (w || dpt)) dims = [w && `Breite ${w} m`, dpt && `Tiefe ${dpt} m`].filter(Boolean).join(', ');
    if (!dims && !area && !hgt && !clear) return null;
    return { value: [dims, area, hgt, clear].filter(Boolean).join(' · '), chip: dims || area, lines: used };
  });

  // PA
  field('pa', '🔊', 'PA', true, (L) => {
    const KEY = /\bP\.?A\.?\b|beschallung|lautsprecher|main\s?(?:system|pa|speaker|hang)|haupt(?:anlage|beschallung|system)|line\s?array|\btops?\b|\bsubs?\b|subwoofer|front\s?fill|nearfill|outfill|delay|speaker|cluster|tonanlage|soundsystem|sound\s?system|endstufe|amping|amplifier|controller|\blake\b|galaxy|processing/i;
    const NOT = /monitor|wedge|side\s?fill|drum\s?fill|in-?ear|\biem\b|backline|bass\s?amp|git\w*\s?amp|key\w*\s?amp|licht|light|strom|power\s?supply/i;
    const lines = L.filter((l) => KEY.test(l.ctx) && !NOT.test(l.text));
    if (!lines.length) return null;
    const sp = speakers(lines);
    const amp = models(lines, /\b(Lab\.?\s?Gruppen\s*\w+|PLM\s?\d+\w*|D80|D20|D40|LA\d{1,2}D?|LA-?RAK\w*|Powersoft\s*\w+|Camco\s*\w+|Crown\s*\w+|Galaxy\s*\w+|Lake\s*\w*)\b/gi, 2);
    const value = sp.length ? [...sp, amp.length ? 'Amps/Processing: ' + amp.join(', ') : ''].filter(Boolean).join(' · ') : firstValue(lines);
    return { value: cap(value, 140), chip: sp[0] ? cap(sp[0].replace(/^\d+×\s*/, ''), 30) : cap(valueOf(lines[0].text), 30), lines };
  });

  // Monitoring
  field('monitor', '🎧', 'Monitoring', true, (L) => {
    const KEY = /monitor|wedge|bodenmonitor|side\s?fill|drum\s?fill|in-?ear|\biem\b|monitorwege?|aux(?:-?wege)?\b|mixes?\b/i;
    const NOT = /monitor\s?(?:pult|console|desk|mischer|techniker|engineer|platz)|mon\s?engineer/i;
    const lines = L.filter((l) => KEY.test(l.ctx) && !NOT.test(l.text));
    if (!lines.length) return null;
    const txt = lines.map((l) => l.text).join(' | ');
    const parts = [];
    const sp = speakers(lines, 3);
    const cnt = txt.match(/(?<![\w.])(\d{1,2})\s*[x×]?\s*(?:stk\.?\s*)?(?:aktive\s*|passive\s*)?(wedges?|bodenmonitor(?:e|en)?|monitorboxen|floor\s?monitors?|monitore\b|monitors\b)/i);
    if (cnt && !sp.some((x) => x.startsWith(cnt[1] + '×'))) parts.push(`${cnt[1]} Wedges`);
    for (const x of sp) parts.push(x);
    const ways = txt.match(/(\d{1,2})\s*(?:monitor)?(?:wege|mixe?s?|aux(?:e|-?wege)?|ways)\b/i) || txt.match(/(?:monitorwege|aux(?:-?wege)?|mixes)\s*[:=]?\s*(\d{1,2})\b/i);
    if (ways) parts.push(`${ways[1]} Wege`);
    const iem = models(lines, IEM, 2);
    if (iem.length) parts.push('IEM: ' + iem.join(', '));
    else if (/in-?ear|\biem\b/i.test(txt)) parts.push(NEG.test(txt.match(/[^|]*(?:in-?ear|iem)[^|]*/i)?.[0] || '') ? 'In-Ear: selbst mitbringen' : 'In-Ear möglich');
    if (/side\s?fill/i.test(txt)) parts.push('Sidefill');
    if (/drum\s?fill/i.test(txt)) parts.push('Drumfill');
    if (!parts.length && NEG.test(txt)) parts.push('keine Monitore vorhanden');
    const value = parts.length ? parts.join(' · ') : firstValue(lines);
    return { value: cap(value, 140), chip: parts[0] || cap(valueOf(lines[0].text), 34), lines };
  });

  // Pulte
  const consoles = (L) => {
    const KEY = /pult|mischpult|console|desk|mixer|konsole|\bfoh\b|front\s?of\s?house|regie/i;
    const lines = L.filter((l) => (KEY.test(l.ctx) || CONSOLE.test(l.text)) && !/licht|light|lighting|\bma\s?[23]\b|grand\s?ma|chamsys|avolites|dj[- ]?(?:pult|mixer)|djm/i.test(l.text));
    CONSOLE.lastIndex = 0;
    const mon = lines.filter((l) => /monitor\s?-?(?:pult|console|desk|mixer|konsole|mischpult)|\bmon\.?\s?(?:pult|console|desk)/i.test(l.ctx));
    const foh = lines.filter((l) => !mon.includes(l));
    return { foh, mon };
  };
  field('foh', '🎚', 'Pult (FOH)', true, (L) => {
    const { foh } = consoles(L);
    if (!foh.length) return null;
    const m = models(foh, CONSOLE, 2);
    const lines = m.length ? foh.filter((l) => allMatches(CONSOLE, l.text).length) : foh.filter((l) => /pult|console|desk|mixer|foh/i.test(l.text));
    if (!lines.length) return null;
    const value = m.length ? m.join(' · ') : firstValue(lines);
    return { value, chip: m[0] || cap(value, 34), lines };
  });
  field('monpult', '🎛', 'Monitorpult', false, (L) => {
    const { mon } = consoles(L);
    const lines = mon.filter((l) => /pult|console|desk|mixer|konsole/i.test(l.ctx) || allMatches(CONSOLE, l.text).length);
    if (!lines.length) return null;
    const m = models(lines, CONSOLE, 2);
    return { value: m.length ? m.join(' · ') : firstValue(lines), lines };
  });

  // Stagebox
  field('stagebox', '🧰', 'Stagebox', true, (L) => {
    const KEY = /stage\s?box|stage\s?rack|i\/o[- ]?(?:box|rack)|input\s?rack|split(?:ter)?\b|digital\s?snake|mixrack/i;
    const lines = L.filter((l) => KEY.test(l.ctx) || allMatches(STAGEBOX, l.text).length);
    if (!lines.length) return null;
    const m = models(lines, STAGEBOX, 3);
    const txt = lines.map((l) => l.text).join(' | ');
    const io = txt.match(/(\d{1,3})\s*(?:in(?:puts?)?|eingänge|ch|kanäle)?\s*\/\s*(\d{1,3})\s*(?:out(?:puts?)?|ausgänge)?\b/i) || txt.match(/(\d{1,3})\s*(?:in(?:puts?)?|eingänge)\D{1,12}(\d{1,3})\s*(?:out(?:puts?)?|ausgänge)/i);
    const parts = [...m];
    if (io && +io[1] >= 4 && +io[1] <= 256) parts.push(`${io[1]} In / ${io[2]} Out`);
    if (/split/i.test(txt)) parts.push(/aktiv|active/i.test(txt) ? 'aktiver Splitter' : 'Splitter');
    const value = parts.length ? uniq(parts).join(' · ') : firstValue(lines);
    return { value: cap(value, 120), chip: m[0] || parts[0] || cap(value, 34), lines };
  });

  // Bühnenanbindung
  field('link', '🔌', 'Bühnenanbindung', true, (L) => {
    const KEY = /anbindung|multicore|multi-?core|glasfaser|fiber|fibre|\blwl\b|optocore|cat\s?[5-7]e?|ethercon|dante|aes\s?50|madi|aes\/?ebu|snake|kabelweg|kabelkanal|kabel(?:länge|strecke|weg)|(?:foh|regie|pult)\D{0,30}(?:distanz|entfernung|abstand|meter|\d+\s*m\b)|(?:distanz|entfernung|abstand)\D{0,25}(?:foh|bühne|regie|stage)|foh\s?position/i;
    const lines = L.filter((l) => KEY.test(l.ctx) && !/licht|light|dmx/i.test(l.text));
    if (!lines.length) return null;
    const txt = lines.map((l) => l.text).join(' | ');
    const parts = [];
    if (/glasfaser|fiber|fibre|\blwl\b|optocore|opticalcon/i.test(txt)) parts.push('Glasfaser');
    const cat = txt.match(/cat\s?([5-7]e?)/i); if (cat) parts.push(`Cat${cat[1]}`); else if (/ethercon/i.test(txt)) parts.push('Cat (etherCON)');
    for (const [re, n] of [[/dante/i, 'Dante'], [/aes\s?50/i, 'AES50'], [/madi/i, 'MADI'], [/optocore/i, 'Optocore'], [/aes\/?ebu/i, 'AES/EBU']]) if (re.test(txt) && !parts.includes(n)) parts.push(n);
    const mc = txt.match(/(\d{1,3})\s*[\/x×]\s*(\d{1,3})\s*(?:kanal\w*\s*)?(?:analog\w*\s*)?multi-?core|multi-?core\D{0,15}(\d{1,3})\s*[\/x×]\s*(\d{1,3})/i);
    if (mc) parts.push(`Multicore ${mc[1] || mc[3]}/${mc[2] || mc[4]}`);
    else if (/analog/i.test(txt) && /multi-?core|kabel/i.test(txt)) parts.push('analoges Multicore');
    const dist = txt.match(/(?:distanz|entfernung|abstand|länge|kabelweg|weg|ca\.)\D{0,20}(\d{1,3})\s*m\b/i) || txt.match(/(\d{1,3})\s*m\b\D{0,25}(?:foh|bühne|stage|regie)/i);
    if (dist) parts.push(`FOH–Bühne ca. ${dist[1]} m`);
    const value = parts.length ? parts.join(' · ') : firstValue(lines);
    return { value: cap(value, 130), chip: parts.slice(0, 2).join(' · ') || cap(value, 34), lines };
  });

  // Strom
  field('power', '⚡', 'Strom', false, (L) => {
    const KEY = /strom|power|cee|schuko|drehstrom|kraftstrom|starkstrom|\d{2,3}\s*a\b|phasen|stromanschl|stromversorgung|verteiler|distro/i;
    const lines = L.filter((l) => KEY.test(l.ctx) && !/lichte\s*h(?:ö|oe)he/i.test(l.text));
    if (!lines.length) return null;
    const txt = lines.map((l) => l.text).join(' | ');
    const parts = [];
    for (const m of txt.matchAll(/(?:(\d+)\s*[x×]\s*)?CEE\s*[-:]?\s*(16|32|63|125)\s*A?|(?:(\d+)\s*[x×]\s*)?(16|32|63|125)\s*A\s*(?:CEE|drehstrom|kraftstrom|3-?phasig|dreiphasig)/gi)) parts.push(`${m[1] || m[3] ? (m[1] || m[3]) + '× ' : ''}CEE ${m[2] || m[4]} A`);
    if (!parts.length) {
      for (const m of txt.matchAll(/(?:(\d+)\s*[x×]\s*)?\b(16|32|63|125)\s*A\b/gi)) {
        const after = txt.slice(m.index, m.index + m[0].length + 25);
        parts.push(`${m[1] ? m[1] + '× ' : ''}${/cee/i.test(after) ? 'CEE ' : ''}${m[2]} A${/3-?phas|drehstrom|three[- ]phase/i.test(after) ? ' (3-phasig)' : ''}`);
      }
    }
    if (/schuko/i.test(txt)) parts.push('Schuko');
    if (/getrennt|separate|eigener\s*stromkreis|separate\s*circuit/i.test(txt)) parts.push('getrennter Kreis für Ton');
    const value = parts.length ? uniq(parts).join(' · ') : firstValue(lines);
    return { value: cap(value, 120), lines };
  });

  // Licht
  field('light', '💡', 'Licht', false, (L) => {
    const KEY = /licht|light|lighting|grand\s?ma|\bma\s?[23]\b|chamsys|avolites|hog\s?4|moving\s?heads?|movingheads?|\bpars?\b|led|scheinwerfer|dimmer|\bdmx\b|\bwash\b|\bbeams?\b|profiler?|hazer|nebel|fog|verfolger|follow\s?spot/i;
    const lines = L.filter((l) => KEY.test(l.ctx) && !/lichte\s*h(?:ö|oe)he|light\s?weight|tageslicht/i.test(l.text));
    if (!lines.length) return null;
    const txt = lines.map((l) => l.text).join(' | ');
    const parts = models(lines, LIGHTDESK, 1).map((d) => 'Pult: ' + d);
    for (const m of txt.matchAll(/(?<![\w.])(\d{1,3})\s*[x×]?\s*(?:stk\.?\s*)?((?:[\w-]+\s){0,2})\(?(moving\s?heads?|movingheads?|spots?|washes|wash|led[- ]?pars?|pars?|profiler?|beams?|blinder|strobes?|fresnels?|verfolger)\b\)?/gi)) {
      parts.push(`${m[1]}× ${clean((m[2] || '') + m[3])}`);
      if (parts.length >= 5) break;
    }
    if (/hazer|nebel|fog/i.test(txt) && !/kein\w*\s*(?:hazer|nebel|fog)|no\s*(?:haze|fog)|verboten|not\s*allowed/i.test(txt)) parts.push('Hazer');
    else if (/(?:nebel|hazer|haze|fog)\D{0,25}(?:verboten|nicht erlaubt|not allowed|untersagt)|kein\w*\s*(?:nebel|hazer)/i.test(txt)) parts.push('kein Nebel/Hazer erlaubt');
    const value = parts.length ? uniq(parts).join(' · ') : firstValue(lines);
    return { value: cap(value, 140), lines };
  });

  // Lautstärke & Zeiten
  field('limits', '🔇', 'Lautstärke & Zeiten', false, (L) => {
    const lines = L.filter((l) => /db\s*\(?\s*a\s*\)?|dba|laeq|lautstärke|pegel|schallpegel|curfew|sperrstunde|nachtruhe|musikende|musik\s*ende|ende\s*der\s*(?:veranstaltung|musik)|veranstaltungsende|lärm|ruhezeit|noise|sound\s*limit/i.test(l.ctx));
    if (!lines.length) return null;
    const txt = lines.map((l) => l.text).join(' | ');
    const parts = [];
    const db = txt.match(/(\d{2,3}(?:[.,]\d)?)\s*dB\s*\(?\s*A\s*\)?/i) || txt.match(/(\d{2,3}(?:[.,]\d)?)\s*dBA/i) || txt.match(/LAeq\D{0,15}(\d{2,3}(?:[.,]\d)?)/i);
    if (db) parts.push(`max. ${db[1]} dB(A)`);
    const cf = txt.match(/(?:curfew|sperrstunde|nachtruhe|musikende|musik\s*ende|ende\s*der\s*(?:veranstaltung|musik)|veranstaltungsende|spätestens|bis|until|end)\D{0,20}?(\d{1,2}[:.]\d{2})/i);
    if (cf) parts.push(`Ende ${cf[1].replace('.', ':')} Uhr`);
    const value = parts.length ? parts.join(' · ') : firstValue(lines);
    return { value: cap(value, 120), lines };
  });

  // Backline
  field('backline', '🥁', 'Backline', false, (L) => {
    const lines = L.filter((l) => /backline|drum\s?set|drum\s?kit|schlagzeug|bass\s?amp|bassverstärker|bass\s?cab|git\w*\s?amp|gitarren\s?(?:amp|verstärker)|keyboard\s?(?:amp|stand|ständer)|flügel|e-?piano|klavier|\bpiano\b|dj[- ]?(?:pult|setup|equipment|mixer)|\bcdj|turntables?|plattenspieler/i.test(l.ctx));
    if (!lines.length) return null;
    return { value: cap(uniq(lines.slice(0, 3).map((l) => valueOf(l.text))).join(' · '), 140), lines };
  });

  // Mikrofone
  field('mics', '🎤', 'Mikrofone & DI', false, (L) => {
    const lines = L.filter((l) => /mikrofon|mikros?\b|microphones?|\bmics?\b|di-?box|funkstrecke|funkmikro|wireless|sm\s?5[78]|beta\s?\d{2}|e\s?9\d{2}|e\s?6\d{2}/i.test(l.ctx));
    if (!lines.length) return null;
    const m = models(lines, MICS, 6);
    return { value: cap(m.length ? m.join(' · ') : firstValue(lines), 140), lines };
  });

  // Load-in
  field('loadin', '🚚', 'Load-in', false, (L) => {
    const lines = L.filter((l) => /load\s?-?in|get\s?-?in|ladezone|laderampe|rampe|anlieferung|lastenaufzug|aufzug|\blift\b|zufahrt|treppe|stufen|stairs|elevator|loading|entladen|ladeweg|tragewege?|ebenerdig/i.test(l.ctx) && !/stellpl|parkpl|parken|nightliner/i.test(l.text));
    if (!lines.length) return null;
    return { value: cap(uniq(lines.slice(0, 2).map((l) => valueOf(l.text))).join(' · '), 140), lines };
  });

  // Parken
  field('parking', '🅿️', 'Parken & Fahrzeuge', false, (L) => {
    const lines = L.filter((l) => /parkpl|parken|parking|nightliner|tourbus|sprinter|stellpl|vehicle|fahrzeug|anhänger|trailer|lkw|truck/i.test(l.ctx) && !/besucher|gäste|publikum/i.test(l.text));
    if (!lines.length) return null;
    return { value: cap(uniq(lines.slice(0, 2).map((l) => valueOf(l.text))).join(' · '), 140), lines };
  });

  // Backstage
  field('backstage', '🛋', 'Backstage', false, (L) => {
    const lines = L.filter((l) => /backstage|garderobe|künstlergarderobe|dressing\s?room|aufenthaltsraum|green\s?room|dusche|shower|künstlerbereich/i.test(l.ctx));
    if (!lines.length) return null;
    return { value: cap(uniq(lines.slice(0, 2).map((l) => valueOf(l.text))).join(' · '), 140), lines };
  });

  // Haustechnik / Kontakt
  field('contact', '☎️', 'Haustechnik / Kontakt', false, (L) => {
    const PHONE = /(?:\+|\b0)\d[\d\s/()-]{6,}\d|[\w.+-]+@[\w-]+\.[\w.-]+/;
    const lines = L.filter((l) => /haustechn|techniker|technische\s*leitung|technischer\s*leiter|ansprechpartner|ansprechperson|kontakt|contact|production|produktion|veranstaltungstechnik|tech\s?contact/i.test(l.ctx) && PHONE.test(l.text));
    if (!lines.length) return null;
    return { value: cap(valueOf(lines[0].text), 120), lines: lines.slice(0, 2) };
  });

  /** Alle erkannten Angaben aus den Ridern einer Location (neueste zuerst übergeben). */
  function extract(docs) {
    const L = linesOf(docs.filter((d) => !d.archived && d.text));
    const out = [];
    for (const f of FIELDS) {
      let r = null;
      try { r = f.fn(L); } catch { r = null; }
      if (!r || !r.value) continue;
      out.push({ key: f.key, icon: f.icon, title: f.title, value: r.value, chip: f.chip ? (r.chip || r.value) : '', quotes: quotes(r.lines || []) });
    }
    return out;
  }

  const FIELD_LIST = FIELDS.map(({ key, icon, title, chip }) => ({ key, icon, title, chip }));
  return { extract, FIELDS: FIELD_LIST, linesOf };
})();
if (typeof module !== 'undefined') module.exports = Venue;
