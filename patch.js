'use strict';
/* ======================================================================
   Inputliste aus dem Rider lesen, Hinweise für den Mix sammeln,
   Stagebox-Profile und Patchplan (Band-Kanal → eigene Stagebox).
   ====================================================================== */
const Patch = (() => {
  /* ---------- Instrumente erkennen ---------- */
  // Text vorbereiten: klein, ohne Umlaute/Akzente, Satzzeichen → Leerzeichen
  const prep = (s) => ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9/+#]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

  // [Klasse, Gruppe, Oberklasse, Muster] – Reihenfolge ist wichtig (Spezielles zuerst)
  const RULES = [
    ['kick_in', 'Drums', 'kick', /\b(kick|bd|bass ?drum|kik|k)\b.*\b(in|inside|innen)\b/],
    ['kick_out', 'Drums', 'kick', /\b(kick|bd|bass ?drum|kik|k)\b.*\b(out|outside|aussen|sub|front)\b/],
    ['kick', 'Drums', 'kick', /\b(kick|bd|bass ?drum|bassdrum|kik|kicks|kickdrum)\b/],
    ['snare_bottom', 'Drums', 'snare', /\b(snare|sn|sd|sna)\b.*\b(bottom|bot|btm|unten|under|down|b)\b/],
    ['snare_top', 'Drums', 'snare', /\b(snare|sn|sd|sna)\b.*\b(top|oben|up|t)\b/],
    ['snare', 'Drums', 'snare', /\b(snare|sn|sd|sna|snare ?drum)\b/],
    ['hihat', 'Drums', 'hihat', /\b(hi ?hat|hihat|hh|hat|hi hat)\b/],
    ['floortom', 'Drums', 'tom', /\b(floor ?tom|floortom|ft|f tom|standtom|stand tom|bodentom|floor)\b/],
    ['tom', 'Drums', 'tom', /\b(toms?|rack ?tom|racktom|hange ?tom|hangetom|tt|rt|mid ?tom|hi ?tom)\b/],
    ['ride', 'Drums', 'cym', /\b(ride)\b/],
    ['oh', 'Drums', 'cym', /\b(oh|ohs|overheads?|over ?heads?|cymbals?|becken|crash)\b/],
    ['room', 'Drums', 'room', /\b(room|rooms|ambience|ambient|amb)\b/],
    ['spd', 'Drums', 'spd', /\b(spd|spd ?sx|sampling ?pad|sample ?pad|multi ?pad|e ?drums?|trigger|sample)\b/],
    ['perc', 'Percussion', 'perc', /\b(perc|percussion|percs|conga|congas|bongos?|cajon|shaker|tamb\w*|cowbell|timbales?|djembe|glock\w*|vibra\w*|marimba|chimes|toys)\b/],
    ['click', 'Playback', 'click', /\b(click|klick|metronom\w*)\b/],
    ['track', 'Playback', 'track', /\b(tracks?|playback|pb|backing ?tracks?|bt|sequen\w*|laptop|ableton|computer|mac|seq|backings|stems?|mtx)\b/],
    ['talkback', 'Talkback', 'talkback', /\b(talk ?back|tb|band ?talk|com|cue ?mic|talk)\b/],
    ['vox_lead', 'Vocals', 'vox', /\b(lead ?vo(x|c|cals?|ice)|lv|lead ?voc\w*|lead ?gesang|gesang ?lead|vo(x|c|cals?) ?lead|hauptgesang|frontm\w*|main ?vo(x|c|cals?)|vox ?lead|voc ?lead|lead singer|leadgesang|leadvocals?)\b/],
    ['vox', 'Vocals', 'vox', /\b(vox|voc|vocals?|gesang|vocal|bvox|bv|bgv|backing ?vo\w*|chor|choir|mc|spoken|ansage|moderation|sprech\w*|stimme|voice|singer|sanger\w*)\b/],
    ['bass_di', 'Bass', 'bass', /\b(bass|bs|e ?bass|bassgitarre|bg)\b.*\b(di|d i|line|direct|xlr)\b|\b(di|d i)\b.*\b(bass|bs)\b/],
    ['bass_mic', 'Bass', 'bass', /\b(bass|bs|e ?bass)\b.*\b(mic|amp|cab|box|mikro)\b/],
    ['bass', 'Bass', 'bass', /\b(bass|bs|e ?bass|bassgitarre|kontrabass|upright|double ?bass|synth ?bass|bassgit\w*)\b/],
    ['acgit', 'Guitar', 'git', /\b(ac|acc|acoustic|akustik\w*|a ?git\w*|a ?gtr|ag|westerngitarre|konzertgitarre|ukulele|uke|mandolin\w*|banjo|nylon)\b/],
    ['git', 'Guitar', 'git', /\b(git\w*|gtr|guit\w*|e ?git\w*|e ?gtr|eg|lead ?gtr|rhythm ?gtr|lead ?guitar)\b/],
    ['keys', 'Keys', 'keys', /\b(keys?|keyboards?|piano|klavier|flugel|rhodes|wurli\w*|organ|orgel|hammond|leslie|synth\w*|nord|moog|e ?piano|ep|clav\w*|akkordeon|accordion|harmonium|mellotron|kb)\b/],
    ['brass', 'Brass', 'brass', /\b(sax\w*|trp|tpt|trumpet|trompete|tbn|trb|trombone|posaune|horns?|brass|blaser|tuba|flute|flote|querflote|clarinet|klarinette|fagott|oboe|flugelhorn|bari|tenor|alto|alt|sopran)\b/],
    ['strings', 'Strings', 'strings', /\b(violin\w*|geige\w*|cello|viola|bratsche|harp|harfe|strings|fiddle)\b/],
    ['fx', 'Sonstiges', 'fx', /\b(fx|effe[ck]t\w*|reverb|hall|delay|return)\b/],
    ['spare', 'Frei', 'spare', /\b(spare|frei|reserve|n\/a|na|leer|empty|tbd|unused|nc)\b/],
  ];

  function sideOf(t) {
    if (/\b(l ?\/ ?r|stereo|st)\b/.test(t)) return 'LR';
    if (/\b(l|left|links|li)\b/.test(t)) return 'L';
    if (/\b(r|right|rechts|re)\b/.test(t)) return 'R';
    return '';
  }
  const idxOf = (t) => { const m = t.match(/\b(\d{1,2})\b/); return m ? +m[1] : null; };

  function classify(label) {
    const t = prep(label);
    if (!t.trim()) return { cls: 'empty', fam: 'Frei', parent: 'spare', side: '', idx: null };
    for (const [cls, fam, parent, re] of RULES) if (re.test(t)) return { cls, fam, parent, side: sideOf(t), idx: idxOf(t) };
    return { cls: 'other', fam: 'Sonstiges', parent: 'other', side: sideOf(t), idx: idxOf(t) };
  }

  /* ---------- Inputliste lesen ---------- */
  const MIC_RE = /\b(sm ?\d{2}\w*|beta ?\d{2}\w*|e ?\d{3}\w*|md ?\d{3}\w*|m ?88\w*|m ?201\w*|m ?160|d ?112\w*|d ?[2-6]\b|i ?5\b|re ?\d{2,3}\w*|c ?\d{3,4}\w*|km ?\d{2,3}\w*|u ?\d{2}\w*|tlm ?\d+\w*|at ?\d{4}\w*|atm ?\d+\w*|nt ?\d\w*|ksm ?\d+\w*|pga ?\d+\w*|dpa\b|d:?vote\w*|40\d\d\b|41\d\d\b|opus ?\d+\w*|mk ?\d+\w*|r ?121|m ?930|ck ?\d+|ribbon|condenser|kondensator\w*|dyn\b|dynam\w*|di|d\.i\.?|di ?-?box|j ?48|bss\w*|ar ?133|radial\w*|klark\w*|palmer\w*|line|xlr|klinke|jack|wireless|funk\w*|ulx\w*|qlx\w*|slx\w*|ad ?x\w*|ew ?\d+\w*|axient\w*|shure|sennheiser|neumann|akg|audix|audio ?-?technica|beyer\w*|electro ?-?voice|ev\b|rode|schoeps|sontronics|telefunken|earthworks|lewitt|heil|countryman|mojave|aston|warm ?audio|own ?mic|eigenes? ?mikro\w*|eigene\w*|provided|vorhanden|band ?mic)\b/i;
  const STAND_RE = /\b((short|tall|small|big|kurz\w*|klein\w*|gro(?:ß|ss)\w*|lang\w*|mini|low|high)\s*)?(boom|booms|stativ\w*|galgen\w*|stand|clip|clamp|klemme|tischstativ|desk|tisch)\b/i;
  const PHANTOM_RE = /(\+\s*48\s*v?|\b48\s*v\b|phantom|\bph\b|\bp48\b)/i;

  const splitFields = (line) => line.split(/\t+|\s+\|\s+|\s*\|\s*|;\s*|\s{3,}/).map((f) => f.trim()).filter((f) => f !== '');

  const HEADER = {
    ch: /^(ch|chan|channel|kanal|kan|nr|no|#|in|input|inp|ip|kan\.?|patch)\.?$/i,
    source: /(instr|source|quelle|signal|was|what|name|beschr|description)/i,
    mic: /(mic|mikro|microphone|abnahme|di\b|pickup|tonabnehmer)/i,
    stand: /(stand|stativ|galgen)/i,
    phantom: /(48|phantom|ph\b|p48)/i,
    note: /(note|bem|comment|kommentar|insert|info|remark|hinweis|position|fx|dyn)/i,
  };
  function mapHeader(fields) {
    const cols = {};
    fields.forEach((f, i) => {
      for (const [k, re] of Object.entries(HEADER)) if (cols[k] === undefined && re.test(f)) { cols[k] = i; break; }
    });
    return cols.source !== undefined && (cols.mic !== undefined || cols.ch !== undefined) ? cols : null;
  }

  const LINE_RE = /^(?:(?:ch(?:annel)?|kanal|kan|input|in|nr|no)\.?\s*)?#?\s*(\d{1,2})(?:\s*(?:\/|&|\+|-|–|\+)\s*(\d{1,2}))?\s*(?:[:.)\]]\s*|\s*[|\t]\s*|\s+[-–]\s+|\s+)(\S.*)$/i;

  function cleanSrc(s) { return String(s || '').replace(/^[\s:.\-–|]+|[\s:.\-–|,]+$/g, '').replace(/\s{2,}/g, ' '); }

  function parseRest(rest, header, fieldsFull) {
    let source = '', mic = '', stand = '', note = '';
    const phantom = PHANTOM_RE.test(rest);
    if (header && fieldsFull && fieldsFull.length >= 2) {
      const g = (k) => (header[k] !== undefined ? fieldsFull[header[k]] || '' : '');
      source = g('source');
      mic = g('mic');
      stand = g('stand');
      note = g('note');
      const ph = g('phantom');
      return { source: cleanSrc(source), mic: cleanSrc(mic), stand: cleanSrc(stand), phantom: phantom || /^(x|ja|yes|y|\+|✓|✔|1|on)$/i.test(ph.trim()), note: cleanSrc(note.replace(PHANTOM_RE, '')) };
    }
    const fields = splitFields(rest);
    if (fields.length >= 2) {
      source = fields[0];
      const others = fields.slice(1);
      const mi = others.findIndex((f) => MIC_RE.test(f));
      if (mi >= 0) mic = others.splice(mi, 1)[0];
      else if (others.length && !STAND_RE.test(others[0]) && !PHANTOM_RE.test(others[0])) mic = others.shift();
      const si = others.findIndex((f) => STAND_RE.test(f));
      if (si >= 0) stand = others.splice(si, 1)[0];
      note = others.filter((f) => !/^(x|\+|✓|-)$/i.test(f)).join(' · ');
    } else {
      const s = fields[0] || '';
      const mm = s.match(MIC_RE);
      if (mm && mm.index > 0) {
        source = s.slice(0, mm.index);
        let tail = s.slice(mm.index);
        const sm = tail.match(STAND_RE);
        if (sm) { mic = tail.slice(0, sm.index); stand = sm[0]; note = tail.slice(sm.index + sm[0].length); } else mic = tail;
      } else {
        const sm = s.match(STAND_RE);
        if (sm && sm.index > 0) { source = s.slice(0, sm.index); stand = sm[0]; note = s.slice(sm.index + sm[0].length); } else source = s;
      }
    }
    const strip = (x) => cleanSrc(String(x).replace(PHANTOM_RE, ''));
    return { source: strip(source), mic: strip(mic), stand: strip(stand), phantom, note: strip(note) };
  }

  /** Liest die Inputliste aus einem Rider-Text. Gibt { rows, score } zurück. */
  function parseInputList(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/ /g, ' ').trim());
    const cands = [];
    let header = null;
    lines.forEach((line, li) => {
      if (!line) return;
      // Tabellenzeilen (Tab oder |) behalten leere Zellen, damit die Spalten zur Kopfzeile passen
      const full = /\t/.test(line) ? line.split('\t').map((f) => f.trim()) : / \| /.test(line) ? line.split('|').map((f) => f.trim()) : splitFields(line);
      const h = full.filter(Boolean).length >= 2 ? mapHeader(full) : null;
      if (h && !/^\d/.test(full[0])) { header = h; return; }
      const m = line.match(LINE_RE);
      if (!m) return;
      const a = +m[1];
      let b = m[2] ? +m[2] : null;
      if (a < 1 || a > 96) return;
      if (b !== null && b !== a + 1) b = null;
      if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(line)) return; // Datum
      const useHeader = header && full.length >= 3 && /^\d/.test(full[header.ch ?? 0] || '') ? header : null;
      cands.push({ li, a, b, rest: m[3], header: useHeader, full });
    });
    // Zusammenhängende Nummernfolgen finden
    const runs = [];
    let cur = [];
    for (const c of cands) {
      const last = cur[cur.length - 1];
      const expect = last ? (last.b || last.a) + 1 : null;
      if (last && c.a >= expect && c.a <= expect + 2 && c.li - last.li <= 6) cur.push(c);
      else { if (cur.length) runs.push(cur); cur = [c]; }
    }
    if (cur.length) runs.push(cur);
    let best = null;
    for (const run of runs) {
      if (run.length < 3) continue;
      const rows = [];
      for (const c of run) {
        const r = parseRest(c.rest, c.header, c.full);
        if (c.b) {
          const pair = (side) => {
            let src = r.source;
            if (/\bl\s*\/\s*r\b/i.test(src)) src = src.replace(/\bl\s*\/\s*r\b/i, side);
            else if (/\bstereo\b/i.test(src)) src = src.replace(/\bstereo\b/i, side);
            else src = src + ' ' + side;
            return { ...r, source: src.trim() };
          };
          rows.push({ ch: c.a, ...pair('L') }, { ch: c.b, ...pair('R') });
        } else rows.push({ ch: c.a, ...r });
      }
      const known = rows.filter((r) => !['other', 'empty'].includes(classify(r.source).cls)).length;
      const mics = rows.filter((r) => r.mic).length;
      const score = rows.length + known * 1.5 + mics + (run[0].a === 1 ? 3 : 0);
      if (known >= 2 && (!best || score > best.score)) best = { rows, score };
    }
    return best || { rows: [], score: 0 };
  }

  /** Beste Inputliste aus allen aktuellen Unterlagen einer Band. */
  function bandInputs(band, docs) {
    const active = docs.filter((d) => !d.archived && d.text);
    if (band.inputList?.edited) {
      const src = docs.find((d) => d.id === band.inputList.sourceDocId);
      const newer = active.find((d) => d.replaces && d.replaces === band.inputList.sourceDocId) || (src && src.archived ? active.find((d) => d.type === src.type) : null);
      return { rows: band.inputList.rows, source: src, edited: true, newer };
    }
    let best = null;
    for (const d of active) {
      const r = parseInputList(d.text);
      const bonus = d.type === 'Inputliste' ? 5 : 0;
      if (r.rows.length && (!best || r.score + bonus > best.score)) best = { rows: r.rows, source: d, score: r.score + bonus };
    }
    return best ? { rows: best.rows, source: best.source, edited: false } : { rows: [], source: null, edited: false };
  }

  /* ---------- Hinweise für den Mix ---------- */
  // Rider-Text in ganze Sätze zerlegen (PDF-Zeilen werden wieder zusammengefügt) und jedem Satz
  // seinen Abschnitt (z. B. „Monitoring“) zuordnen – so geht weniger Kontext verloren.
  const SECTION_RE = /^(monitor\w*|in[\s-]?ears?|iem|backline|input ?list\w*|inputliste|kanalliste|stage ?plot|b(ü|ue)hne\w*|stage|strom|power|foh|pa\b|pa[- ]?anlage|licht\w*|light\w*|hospitality|catering|kontakt\w*|contact\w*|ablauf|zeitplan|schedule|soundcheck|technik\w*|technical|tech\w*|allgemein\w*|general|mikro\w*|microphones?|drums?|schlagzeug|bass|gitarren?|guitars?|keys|keyboards?|vocals?|gesang|band|besetzung|line ?up|personal|crew|effekte|fx|sonstiges|misc\w*|notes|hinweise|wichtig\w*|important)\b/i;
  const FUNC_WORDS = /\b(und|mit|der|die|das|wir|ein|eine|einen|für|bitte|ist|sind|wird|werden|the|and|with|we|our|is|are|will|please|unser\w*|kein\w*|nicht)\b/i;

  function sentencesOf(docs) {
    const out = [];
    for (const d of docs) {
      const raw = String(d.text || d.notes || '').replace(/\t+/g, ' · ');
      const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
      let section = '', buf = '';
      const flush = () => {
        if (buf.trim()) {
          // Abkürzungen (ca., mind., z. B. …) schützen, dann an Satzenden trennen
          const safe = buf.replace(/\b(ca|mind|max|min|inkl|exkl|bzw|evtl|ggf|z|u|d|o|usw|etc|nr|tel|str|vgl|approx|incl|ext|bspw|zzgl|abzgl|v|s)\.(?=\s*\S)/gi, '$1\u2024');
          for (const s of safe.split(/(?<=[.!?;])\s+(?=[A-ZÄÖÜ„"(•-])/)) if (s.trim().length > 2) out.push({ text: s.trim().replace(/\u2024/g, '.'), section, doc: d });
        }
        buf = '';
      };
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l) { flush(); continue; }
        const words = l.split(' ').length;
        const heading = (/:$/.test(l) && words <= 6) || (words <= 4 && l.length <= 40 && !FUNC_WORDS.test(l) && !/[.,;]$/.test(l) &&
          (SECTION_RE.test(l.replace(/^[\d.)\s#-]+/, '')) || (l === l.toUpperCase() && /[A-ZÄÖÜ]{3}/.test(l))));
        if (heading) { flush(); section = l.replace(/[:\s]+$/, ''); continue; }
        const item = /^([-•*–·▪●]|\d{1,2}[.)]\s|\d{1,2}\s·)/.test(l) || l.includes(' · ') || /^[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß \-\/&+]{1,28}:\s*\S/.test(l);
        if (item) { flush(); buf = l.replace(/^[-•*–·▪●]\s*/, ''); flush(); continue; }
        if (buf && /[.!?:]$/.test(buf) && !/\b(ca|mind|max|min|inkl|exkl|bzw|evtl|ggf|z\. ?b|u\. ?a|usw|etc|nr|vgl|approx|incl|bspw|zzgl)\.$/i.test(buf)) flush();
        buf = buf ? buf + ' ' + l : l;
      }
      flush();
    }
    return out;
  }

  const NUM_WORDS = { ein: 1, eine: 1, einen: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, fuenf: 5, five: 5, sechs: 6, six: 6, sieben: 7, seven: 7, acht: 8, eight: 8, neun: 9, nine: 9, zehn: 10, ten: 10, zwölf: 12, twelve: 12 };
  const NUM = '(\\d{1,2}|ein|eine|einen|one|zwei|two|drei|three|vier|four|fünf|fuenf|five|sechs|six|sieben|seven|acht|eight|neun|nine|zehn|ten|zwölf|twelve)';
  const toNum = (s) => (/^\d+$/.test(s) ? +s : NUM_WORDS[s.toLowerCase()] || null);
  const NEG_BEFORE = /\b(kein|keine|keinen|keiner|keinem|nicht|ohne|no|not|without|none|nein|kein\w*)\b[^.!?;]{0,25}$/i;
  const NEG_AFTER = /^[^.!?;]{0,45}\b(nicht (benötigt|nötig|notwendig|erforderlich|gebraucht|vorhanden|gewünscht|nötig)|not (needed|required|necessary|wanted)|entfällt|entfallen|brauchen wir nicht|benötigen wir nicht|wird nicht|werden nicht|n\/a)\b/i;
  const OWN_RE = /\b(eigene[nmrs]?|eigen\w*|own|wir bringen|we bring|bringen\b[^.!?;]{0,40}\bmit|mitbringen|mitgebracht|selbst|dabei|haben wir|is provided by the band|von der band)\b/i;
  const PROVIDE_RE = /\b(bitte\b[^.!?;]{0,50}\b(stellen|bereitstellen|bereithalten|organisieren|mieten|vorhanden)|stellt\b|zu stellen|gestellt werden|wird gestellt|vom veranstalter|veranstalter stellt|vor ort|haus ?technik|house|venue|benötigen|brauchen|please provide|needs? to be provided|required|wird benötigt|werden benötigt|muss vorhanden|bereitzustellen|provided by (the )?(venue|promoter|organi[sz]er))\b/i;

  function insights(docs, rows) {
    const tech = docs.filter((d) => !d.archived && !['Hospitality'].includes(d.type));
    const sents = sentencesOf(tech);
    const facts = [];
    const add = (icon, title, value, level, quotes = []) => facts.push({ icon, title, value, level, quotes: [...new Set(quotes.map((q) => q.text || q))].slice(0, 4) });

    // Belege für ein Stichwort sammeln – getrennt nach bejaht / verneint
    const evidence = (re, { sections } = {}) => {
      const pos = [], neg = [];
      for (const s of sents) {
        const m = s.text.match(re);
        const inSection = sections && sections.test(s.section);
        if (!m && !inSection) continue;
        if (!m) { pos.push({ ...s, weak: true }); continue; }
        const before = s.text.slice(0, m.index), after = s.text.slice(m.index);
        (NEG_BEFORE.test(before) || NEG_AFTER.test(after) ? neg : pos).push(s);
      }
      return { pos: pos.filter((s) => !s.weak).concat(pos.filter((s) => s.weak)), neg, strong: pos.filter((s) => !s.weak) };
    };
    const countIn = (list, nounRe) => {
      let best = null;
      for (const s of list) {
        const t = s.text;
        for (const m of t.matchAll(new RegExp(`\\b${NUM}\\s*(?:x|×|stück|stk\\.?|pcs\\.?)?\\s*(?:[a-zäöü-]+\\s+){0,2}?(?:${nounRe})`, 'gi'))) { const n = toNum(m[1]); if (n && (!best || n > best)) best = n; }
        for (const m of t.matchAll(new RegExp(`(?:${nounRe})\\s*[:=]?\\s*(?:x\\s*)?(\\d{1,2})\\b(?!\\s*(m|cm|min|v|a|kw|db|%|x\\s*\\d))`, 'gi'))) { const n = +m[1]; if (n && (!best || n > best)) best = n; }
      }
      return best;
    };
    const cls = rows.map((r) => ({ ...classify(r.source), r }));
    const has = (c) => cls.some((x) => x.cls === c);

    // In-Ear
    const IEM = /in[\s-]?ears?|\biems?\b|ear ?monitor\w*|\bpsm ?\d*|in-ohr/i;
    const iem = evidence(IEM, { sections: /^(in[\s-]?ear|iem)/i });
    const iemOwn = iem.strong.filter((s) => OWN_RE.test(s.text) && !PROVIDE_RE.test(s.text))
      .concat(sents.filter((s) => /(in[\s-]?ear|iem|monitor)/i.test(s.section) && /\b(rack|split\w*|mixer|pult|desk|console)\b/i.test(s.text) && OWN_RE.test(s.text)));
    const iemProvide = iem.strong.filter((s) => PROVIDE_RE.test(s.text) && !OWN_RE.test(s.text));
    const partly = iem.strong.find((s) => /\b(nur|only|teilweise|partly|zum teil)\b[^.!?;]{0,25}(in[\s-]?ear|iem)|(in[\s-]?ear|iem)\w*[^.!?;]{0,20}\b(nur|only)\s+(für|for|bei|von|der|die|das|den|gesang|vocals?|drums?)|\b(außer|ausser|except)\b/i.test(s.text));
    if (iem.strong.length || iemOwn.length) {
      let v = 'Ja';
      if (iemOwn.length) v = 'Ja – eigenes Rack / Split';
      else if (iemProvide.length) v = 'Ja – Sender/Empfänger vom Veranstalter';
      if (partly) v += ' · teilweise';
      add('🎧', 'In-Ear', v, iemOwn.length || iemProvide.length ? 'warn' : 'info', [...iemOwn, ...iemProvide, ...iem.strong]);
    } else if (iem.neg.length) add('🎧', 'In-Ear', 'Nein', 'info', iem.neg);
    else add('🎧', 'In-Ear', 'nicht erwähnt', 'muted');
    if (iemOwn.length && rows.length) add('🔀', 'Kanalnummern', 'Inputliste = Split der Band → im Bereich „Patch“ auf deine Stagebox legen', 'info');

    // Wedges & Monitorwege
    const WEDGE = 'wedges?|bodenmonitor\\w*|monitorbox\\w*|monitor ?boxen|floor ?monitors?|monitorlautsprecher|keile?';
    const wedge = evidence(new RegExp(WEDGE + '|sidefills?|drum ?fills?', 'i'));
    if (wedge.strong.length) {
      const n = countIn(wedge.strong, WEDGE);
      const extra = [wedge.strong.some((s) => /sidefill/i.test(s.text)) && 'Sidefill', wedge.strong.some((s) => /drum ?fill/i.test(s.text)) && 'Drumfill'].filter(Boolean);
      add('🔊', 'Wedges / Fills', [n ? `${n} Wedge${n > 1 ? 's' : ''}` : 'Wedges gewünscht', ...extra].join(' + '), 'info', wedge.strong);
    } else if (wedge.neg.length) add('🔊', 'Wedges', 'keine', 'info', wedge.neg);
    const MIX = 'monitor ?wege|monitorwege|monitor ?mix(?:es|e)?|monitormix\\w*|mixe|aux(?:e|es|wege)?|wege|mixes|sends';
    const mixSents = sents.filter((s) => new RegExp(MIX, 'i').test(s.text) && (/monitor|aux|mix/i.test(s.text) || /monitor/i.test(s.section)));
    const mixN = countIn(mixSents, MIX);
    if (mixN) add('🎚', 'Monitorwege', `${mixN}`, 'info', mixSents);

    // Pult & Personal
    const desk = evidence(/\b(foh|monitor)?[- ]?(pult|console|desk|mischpult|mixer|mischer)\b/i);
    const ownDesk = desk.strong.filter((s) => OWN_RE.test(s.text) && !PROVIDE_RE.test(s.text));
    if (ownDesk.length) {
      const mon = ownDesk.some((s) => /monitor|in[\s-]?ear|iem/i.test(s.text + ' ' + s.section)), foh = ownDesk.some((s) => /\bfoh\b|front/i.test(s.text));
      add('🎛', 'Eigenes Pult', foh && mon ? 'FOH + Monitor' : foh ? 'FOH' : mon ? 'Monitor / In-Ear' : 'Ja', 'warn', ownDesk);
    }
    const ENG = /(techniker\w*|engineer|tonmann|tontechniker\w*|tonfrau|mischer\w*|soundguy|sound ?(guy|engineer|person)|foh[- ]?engineer|monitor[- ]?engineer)/i;
    const eng = evidence(ENG);
    const ownEng = eng.strong.filter((s) => OWN_RE.test(s.text) || /\b(unser\w*|our)\b/i.test(s.text));
    const noEng = eng.neg.filter((s) => OWN_RE.test(s.text) || /\b(unser\w*|our)\b/i.test(s.text));
    if (ownEng.length) add('🧑‍🔧', 'Eigene:r Techniker:in', /monitor/i.test(ownEng.map((s) => s.text).join(' ')) ? 'Ja (u. a. Monitor)' : 'Ja', 'info', ownEng);
    else if (noEng.length) add('🧑‍🔧', 'Eigene:r Techniker:in', 'Nein – du mischst', 'info', noEng);
    const micS = evidence(/\b(mikro\w*|mics?|microphones?)\b/i).strong.filter((s) => OWN_RE.test(s.text) && !PROVIDE_RE.test(s.text));
    if (micS.length) add('🎤', 'Eigene Mikros', 'Ja – teilweise oder komplett', 'info', micS);

    // Playback / Click
    const clickE = evidence(/\b(click|klick|metronom\w*)\b/i);
    const trackE = evidence(/\b(playback|backing ?tracks?|tracks?|ableton|zuspieler|sequen\w*|in-?sync)\b/i);
    const click = has('click') || clickE.strong.length, tracks = has('track') || trackE.strong.length;
    if (click || tracks) {
      const where = clickE.strong.some((s) => /(nur|only)[^.]{0,20}(in[\s-]?ear|iem|monitor|drum)/i.test(s.text)) ? ' (Click nur Monitor)' : '';
      add('⏱', 'Click / Playback', [click && 'Click', tracks && 'Tracks'].filter(Boolean).join(' + ') + where, 'warn', [...clickE.strong, ...trackE.strong]);
    } else if (clickE.neg.length || trackE.neg.length) add('⏱', 'Click / Playback', 'Nein', 'info', [...clickE.neg, ...trackE.neg]);

    // Funk
    const wirelessRows = rows.filter((r) => /wireless|funk|ulx|qlx|slx|axient|ew ?\d|ad ?x|drahtlos/i.test(r.mic + ' ' + r.note));
    const wl = evidence(/\b(funk\w*|wireless|drahtlos\w*|sender|frequen\w*|handsender|taschensender)\b/i);
    if (wirelessRows.length || wl.strong.length) {
      const own = wl.strong.some((s) => OWN_RE.test(s.text));
      add('📡', 'Funkstrecken', (wirelessRows.length ? `${wirelessRows.length} Kanal${wirelessRows.length > 1 ? 'e' : ''}` : 'Ja') + (own ? ' (eigene)' : '') + ' – Frequenzen abklären', 'warn', wl.strong);
    }

    // Instrumente / Besonderheiten
    const fams = {};
    for (const x of cls) if (!['Drums', 'Bass', 'Guitar', 'Vocals', 'Frei', 'Playback', 'Talkback', 'Sonstiges'].includes(x.fam)) (fams[x.fam] ||= []).push(x.r.source);
    for (const [f, list] of Object.entries(fams)) add('🎹', f, [...new Set(list)].join(', '), 'info');
    const ac = cls.filter((x) => x.cls === 'acgit').map((x) => x.r.source);
    if (ac.length) add('🎸', 'Akustische Instrumente', ac.join(', '), 'info');
    const vox = cls.filter((x) => x.fam === 'Vocals');
    if (vox.length) add('🗣', 'Gesang', `${vox.length} Mikro${vox.length > 1 ? 's' : ''}` + (vox.find((x) => x.cls === 'vox_lead') ? ` · Lead: ${vox.find((x) => x.cls === 'vox_lead').r.source}` : ''), 'info');

    // Technik-Zahlen
    if (rows.length) {
      const di = rows.filter((r) => /\bdi\b|d\.i|di ?box|j ?48|bss|ar ?133|radial|klark|palmer|line/i.test(r.mic)).length;
      const ph = rows.filter((r) => r.phantom).length;
      const pairs = rows.filter((r) => classify(r.source).side === 'L').length;
      add('🔢', 'Inputs', `${rows.length} Kanäle` + (pairs ? ` · ${pairs} Stereo-Paar${pairs > 1 ? 'e' : ''}` : '') + (di ? ` · ${di} DI` : '') + (ph ? ` · ${ph}× +48V` : ''), 'info');
    } else add('🔢', 'Inputliste', 'nicht gefunden – unten manuell anlegen', 'warn');

    // Bühne & Sonstiges
    const riser = evidence(/\b(drum ?riser|riser|podest\w*|drumpodest\w*|drum ?podium)\b/i);
    if (riser.strong.length) {
      const size = riser.strong.map((s) => (s.text.match(/(\d+(?:[.,]\d+)?\s*(?:m|cm)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:m|cm)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:m|cm))?)/i) || [])[1]).find(Boolean);
      const own = riser.strong.some((s) => OWN_RE.test(s.text) && !PROVIDE_RE.test(s.text));
      add('🥁', 'Drumriser', (own ? 'bringen sie mit' : 'wird benötigt') + (size ? ` (${size.replace(/\s+/g, '')})` : ''), own ? 'info' : 'warn', riser.strong);
    } else if (riser.neg.length) add('🥁', 'Drumriser', 'nicht nötig', 'info', riser.neg);
    const bl = evidence(/\bbackline\b/i, { sections: /^backline/i });
    if (bl.strong.length || bl.pos.length) {
      const need = bl.pos.some((s) => PROVIDE_RE.test(s.text)), own = bl.pos.some((s) => OWN_RE.test(s.text));
      add('🧳', 'Backline', need && !own ? 'muss gestellt werden' : own && !need ? 'bringen sie mit' : need && own ? 'teils eigene, teils gestellt' : 'siehe Rider', need ? 'warn' : 'info', bl.pos);
    }
    const power = evidence(/\b(strom\w*|power|steckdose\w*|schuko|230 ?v|cee|16 ?a|32 ?a|mehrfachsteck\w*|stromanschl\w*)\b/i).strong;
    if (power.length) {
      const n = countIn(power, 'schuko\\w*|steckdosen?|stromanschl\\w*|power ?(?:outlets?|points?)|outlets?');
      add('🔌', 'Strom', n ? `${n}× Strom auf der Bühne` : 'Anforderungen im Rider', 'info', power);
    }
    const fx = evidence(/\b(reverb|hall\w*|delay\w*|effe[ck]t\w*|fx|tap ?tempo|vocoder|harmonizer|auto-?tune|echo)\b/i).strong;
    if (fx.length) add('✨', 'Effekte', `${fx.length} Wunsch${fx.length > 1 ? 'e' : ''} im Rider`, 'info', fx);
    const sc = evidence(/\b(soundcheck|line ?check|changeover|umbau\w*|get ?in|aufbau\w*|load ?in)\b/i).strong;
    if (sc.length) {
      const times = [];
      for (const s of sc) for (const m of s.text.matchAll(/\b(soundcheck|line ?check|changeover|umbau\w*|aufbau\w*|load ?in|get ?in)\b[^!?;\d]{0,30}(\d{1,3})\s*(min\w*|minuten|minutes|std|h\b|stunden?|hours?)/gi)) times.push(`${m[1]} ${m[2]} ${/^(std|h|stund|hour)/i.test(m[3]) ? 'h' : 'min'}`);
      add('🕒', 'Soundcheck / Umbau', times.length ? [...new Set(times)].slice(0, 3).join(' · ') : 'Zeiten im Rider', 'info', sc);
    }
    const imp = sents.filter((s) => /\b(wichtig|important|unbedingt|zwingend|must|required|bitte beachten|please note|achtung|attention|no ?go|nicht erlaubt|keinesfalls|auf keinen fall|essential|mandatory)\b/i.test(s.text));
    if (imp.length) add('⚠️', 'Wichtige Hinweise', `${imp.length} Stelle${imp.length > 1 ? 'n' : ''} im Rider`, 'warn', imp.slice(0, 6));
    return facts;
  }

  /* ---------- Stagebox-Profile ---------- */
  const TEMPLATE_32 = ['Kick In', 'Kick Out', 'Snare Top', 'Snare Bottom', 'HiHat', 'Tom 1', 'Tom 2', 'Floor Tom', 'OH L', 'OH R',
    'Bass DI', 'Bass Mic', 'Git 1', 'Git 2', 'Akustikgitarre', 'Keys L', 'Keys R', 'Synth L', 'Synth R', 'Perc', 'Track L', 'Track R', 'Click',
    'Spare', 'Vox Lead', 'Vox 2', 'Vox 3', 'Vox 4', 'Spare', 'Spare', 'Spare', 'Talkback'];
  const newProfile = (name, labels) => ({
    id: uid(), name, notes: '', createdAt: nowIso(),
    channels: labels.map((label, i) => ({ ch: i + 1, label, note: '' })),
  });

  /* ---------- Patch erzeugen ---------- */
  /**
   * Ordnet jedem Band-Input einen Kanal der Stagebox zu.
   * overrides: { [stageboxKanal]: bandKanal | 0 } – manuelle Zuordnungen (0 = frei lassen)
   */
  function generate(rows, profile, overrides = {}) {
    const slots = profile.channels.map((c) => ({ ...c, k: classify(c.label), input: null, how: '' }));
    const inputs = rows.map((r) => ({ r, k: classify(r.source), slot: null }));
    const byCh = new Map(inputs.map((x) => [x.r.ch, x]));
    // Kein ausdrücklicher Lead-Gesang? Dann gilt das erste Gesangsmikro als Lead.
    if (!inputs.some((x) => x.k.cls === 'vox_lead')) {
      const v = inputs.find((x) => x.k.cls === 'vox');
      if (v) v.k = { ...v.k, cls: 'vox_lead', idx: null };
    }

    for (const [sCh, bCh] of Object.entries(overrides)) {
      const s = slots.find((x) => x.ch === +sCh);
      if (!s) continue;
      if (!bCh) { s.locked = true; continue; }
      const inp = byCh.get(+bCh);
      if (inp && !inp.slot) { s.input = inp; inp.slot = s; s.how = 'manual'; s.locked = true; }
    }
    const free = (s) => !s.input && !s.locked;
    const isSpare = (s) => ['spare', 'empty'].includes(s.k.cls);
    const pass = (how, test) => {
      for (const inp of inputs) {
        if (inp.slot || ['spare', 'empty'].includes(inp.k.cls)) continue;
        const s = slots.find((x) => free(x) && !isSpare(x) && test(inp.k, x.k));
        if (s) { s.input = inp; inp.slot = s; s.how = how; }
      }
    };
    const sideOk = (a, b) => a.side === b.side || a.side === 'LR' || b.side === 'LR' || (!a.side && !b.side);
    pass('exact', (a, b) => a.cls === b.cls && sideOk(a, b) && a.idx === b.idx);
    pass('exact', (a, b) => a.cls === b.cls && sideOk(a, b) && (a.idx === null || b.idx === null));
    pass('class', (a, b) => a.cls === b.cls && sideOk(a, b));
    pass('class', (a, b) => a.cls === b.cls);
    pass('similar', (a, b) => a.parent === b.parent && sideOk(a, b));
    pass('similar', (a, b) => a.parent === b.parent);
    pass('family', (a, b) => a.fam === b.fam && a.fam !== 'Sonstiges' && sideOk(a, b));

    // Rest: zuerst freie/Spare-Kanäle, dann ungenutzte Kanäle. Stereo-Paare bleiben nebeneinander.
    const rest = inputs.filter((x) => !x.slot && !['spare', 'empty'].includes(x.k.cls));
    const order = [...slots.filter((s) => free(s) && isSpare(s)), ...slots.filter((s) => free(s) && !isSpare(s)).reverse()];
    const extra = [];
    for (let i = 0; i < rest.length; i++) {
      const inp = rest[i];
      if (inp.slot) continue;
      const mate = inp.k.side === 'L' ? rest.find((x) => !x.slot && x !== inp && x.k.side === 'R' && x.k.cls === inp.k.cls) : null;
      if (mate) {
        const s = order.find((x) => free(x) && slots.find((y) => y.ch === x.ch + 1 && free(y)));
        if (s) {
          const s2 = slots.find((y) => y.ch === s.ch + 1);
          s.input = inp; inp.slot = s; s.how = 'free';
          s2.input = mate; mate.slot = s2; s2.how = 'free';
          continue;
        }
      }
      const s = order.find(free);
      if (s) { s.input = inp; inp.slot = s; s.how = 'free'; } else extra.push(inp);
    }
    let next = Math.max(0, ...slots.map((s) => s.ch)) + 1;
    const overflow = extra.map((inp) => ({ ch: next++, label: '', input: inp, how: 'overflow', k: inp.k }));
    return { slots, overflow, unassigned: inputs.filter((x) => !x.slot && !overflow.some((o) => o.input === x)) };
  }

  return { classify, parseInputList, bandInputs, insights, sentencesOf, generate, newProfile, TEMPLATE_32, splitFields };
})();
