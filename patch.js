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
  function insights(docs, rows) {
    const active = docs.filter((d) => !d.archived);
    const lines = [];
    for (const d of active) for (const l of String(d.text || d.notes || '').split(/\r?\n/)) {
      const t = l.replace(/\s+/g, ' ').trim();
      if (t.length > 2) lines.push(t);
    }
    const find = (re, n = 3) => [...new Set(lines.filter((l) => re.test(l)))].slice(0, n);
    const facts = [];
    const add = (icon, title, value, level, quotes = []) => facts.push({ icon, title, value, level, quotes });
    const cls = rows.map((r) => ({ ...classify(r.source), r }));
    const has = (c) => cls.some((x) => x.cls === c);

    // In-Ear
    const iem = find(/in[\s-]?ears?|\biems?\b|ear ?monitor|\bpsm\b|in-ohr/i);
    const ownRack = find(/(eigen\w*|own|bring\w*|mitbr\w*|selbst|stellen|provide)[^.]{0,60}(rack|in[\s-]?ear|iem|split\w*|monitor ?(pult|mixer|desk|console)|mixer|x ?32|xr ?1[28]|wing|dm ?[37]|qu ?-?\d+|sq ?-?\d|tf ?\d|ui ?24|m32|cl ?\d|ql ?\d)|(rack|in[\s-]?ear|iem|split\w*)[^.]{0,40}(eigen\w*|own|wir bringen|we bring|selbst|mit\b)/i);
    if (iem.length) add('🎧', 'In-Ear', ownRack.length ? 'Ja – eigenes Rack / Split' : 'Ja', ownRack.length ? 'warn' : 'info', [...ownRack, ...iem].slice(0, 3));
    else add('🎧', 'In-Ear', 'nicht erwähnt', 'muted');
    if (ownRack.length && rows.length) add('🔀', 'Kanalnummern', 'Inputliste = Split der Band → im Bereich „Patch“ auf deine Stagebox legen', 'info');

    // Wedges & Monitorwege
    const wedgeQ = find(/wedges?|bodenmonitor\w*|monitorbox\w*|floor ?monitors?|sidefills?|drum ?fills?|monitorlautsprecher/i);
    const wedgeN = (lines.join(' ').match(/(\d+)\s*x?\s*(wedges?|bodenmonitore?|monitorboxen|floor ?monitors?)/i) || [])[1];
    if (wedgeQ.length) add('🔊', 'Wedges / Fills', wedgeN ? `${wedgeN} Wedges` + (find(/sidefill/i).length ? ' + Sidefill' : '') + (find(/drum ?fill/i).length ? ' + Drumfill' : '') : 'gewünscht', 'info', wedgeQ);
    const mixN = (lines.join(' ').match(/(\d+)\s*x?\s*(monitor ?wege|monitorwege|monitor ?mix(es|e)?|mixe|aux(e|es)?|wege|mixes)\b/i) || [])[1];
    if (mixN) add('🎚', 'Monitorwege', mixN, 'info', find(/monitor ?wege|monitorwege|monitor ?mix|aux/i));

    // Pult & Personal
    const ownDesk = find(/(eigene[sn]?|own|bring\w*|mitbr\w*)[^.]{0,40}(foh|pult|console|desk|mischpult|mixer)/i);
    if (ownDesk.length) add('🎛', 'Eigenes Pult', 'Ja', 'warn', ownDesk);
    const ownTech = find(/(eigene[rn]?|own|unser\w*|our)[^.]{0,25}(techniker|engineer|tonmann|tontechniker\w*|foh[- ]?engineer|monitor[- ]?engineer|sound ?(guy|engineer|person))/i);
    if (ownTech.length) add('🧑‍🔧', 'Eigene:r Techniker:in', 'Ja', 'info', ownTech);
    const ownMics = find(/(eigene|own|bring\w*|mitbr\w*)[^.]{0,30}(mikro\w*|mics?|microphones?)/i);
    if (ownMics.length) add('🎤', 'Eigene Mikros', 'Ja', 'info', ownMics);

    // Playback / Click
    const click = has('click') || find(/\bclick|\bklick|metronom/i).length;
    const tracks = has('track') || find(/playback|backing ?tracks?|ableton|zuspieler/i).length;
    if (click || tracks) add('⏱', 'Click / Playback', [click && 'Click', tracks && 'Tracks'].filter(Boolean).join(' + '), 'warn', find(/click|klick|playback|backing ?track|ableton/i));

    // Funk
    const wirelessRows = rows.filter((r) => /wireless|funk|ulx|qlx|slx|axient|ew ?\d|ad ?x/i.test(r.mic + ' ' + r.note));
    const wirelessQ = find(/funk|wireless|drahtlos|sender|frequen/i);
    if (wirelessRows.length || wirelessQ.length) add('📡', 'Funkstrecken', (wirelessRows.length ? wirelessRows.length + (wirelessRows.length > 1 ? ' Kanäle' : ' Kanal') : 'Ja') + ' – Frequenzen abklären', 'warn', wirelessQ);

    // Instrumente / Besonderheiten
    const fams = {};
    for (const x of cls) if (!['Drums', 'Bass', 'Guitar', 'Vocals', 'Frei', 'Playback', 'Talkback'].includes(x.fam)) (fams[x.fam] ||= []).push(x.r.source);
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
    const riser = find(/riser|podest|drumpodest|drum ?podium/i, 2);
    if (riser.length) add('🥁', 'Drumriser', 'gewünscht', 'info', riser);
    const backline = find(/backline/i, 2);
    if (backline.length) add('🧳', 'Backline', 'erwähnt', 'info', backline);
    const power = find(/strom|power|steckdose|schuko|230 ?v|\bcee\b|16 ?a\b|32 ?a\b|mehrfachsteck/i, 3);
    if (power.length) add('🔌', 'Strom', 'Anforderungen im Rider', 'info', power);
    const fx = find(/reverb|\bhall\b|delay|effe[ck]t|\bfx\b|tap ?tempo|vocoder|harmonizer|autotune|auto-tune/i, 3);
    if (fx.length) add('✨', 'Effekte', 'Wünsche im Rider', 'info', fx);
    const sc = find(/soundcheck|line ?check|changeover|umbau|get ?in|aufbau/i, 3);
    if (sc.length) add('🕒', 'Soundcheck / Umbau', 'Zeiten im Rider', 'info', sc);
    const imp = find(/wichtig|important|unbedingt|zwingend|\bmust\b|required|bitte beachten|please note|achtung|attention|no ?go|nicht erlaubt|keine?\s+\w+\s+(erlaubt|möglich)|essential/i, 6);
    if (imp.length) add('⚠️', 'Wichtige Hinweise', `${imp.length} Stelle${imp.length > 1 ? 'n' : ''} im Rider`, 'warn', imp);
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

  return { classify, parseInputList, bandInputs, insights, generate, newProfile, TEMPLATE_32, splitFields };
})();
