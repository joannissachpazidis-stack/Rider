'use strict';
/* ======================================================================
   Team & Teilen
   Bands, Rider und Stagebox-Profile sieht das ganze Team.
   Konzerte/Festivals haben "sharedWith": [] = nur wer es angelegt hat,
   ['*'] = ganzes Team, sonst die ausgewählten E-Mails.
   ====================================================================== */
const Share = (() => {
  const KEY = 'share.default';
  const on = () => Cloud.loggedIn();
  const short = (email) => String(email || '').split('@')[0];
  const ownerOf = (c) => c?.owner || Cloud.myEmail;
  const mode = (list = []) => (list.includes('*') ? 'team' : list.length ? 'some' : 'me');

  function defaults() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  const remember = (list) => localStorage.setItem(KEY, JSON.stringify(list));

  // Kurzbeschreibung, z. B. "🔒 Nur ich", "👥 Team", "👥 3 Personen · von anna"
  function label(c) {
    const list = c.sharedWith || [];
    const m = mode(list);
    const own = ownerOf(c);
    const mine = own === Cloud.myEmail;
    let t = m === 'team' ? '👥 Team' : m === 'some' ? `👥 ${list.filter((e) => e !== own).length + 1} Personen` : mine ? '🔒 Nur ich' : '👥 Geteilt';
    if (!mine) t += ` · von ${esc(short(own))}`;
    return t;
  }
  const badge = (c) => (on() ? `<span class="badge share" title="Sichtbar für">${label(c)}</span>` : '');

  // Auswahl "Sichtbar für" für Formulare
  function picker(c = null) {
    if (!on()) return '';
    const list = c ? c.sharedWith || [] : defaults();
    const m = mode(list);
    const own = ownerOf(c);
    const people = Cloud.team.filter((e) => e !== own);
    const ownLabel = own === Cloud.myEmail ? 'Nur ich' : `Nur ${esc(short(own))} (angelegt)`;
    return `
      <fieldset class="share-pick">
        <legend>Sichtbar für</legend>
        <label class="radio"><input type="radio" name="share" value="me" ${m === 'me' ? 'checked' : ''}> 🔒 ${ownLabel}</label>
        ${people.length ? `
        <label class="radio"><input type="radio" name="share" value="team" ${m === 'team' ? 'checked' : ''}> 👥 Ganzes Team</label>
        <label class="radio"><input type="radio" name="share" value="some" ${m === 'some' ? 'checked' : ''}> Ausgewählte Personen</label>
        <div class="share-people" ${m === 'some' ? '' : 'hidden'}>
          ${people.map((e) => `<label class="check"><input type="checkbox" value="${esc(e)}" ${list.includes(e) ? 'checked' : ''}> ${esc(e)}</label>`).join('')}
        </div>` : '<p class="muted small">Noch niemand sonst im Team – unter „Cloud“ kannst du Kolleg:innen hinzufügen.</p>'}
      </fieldset>`;
  }
  function bindPicker(root) {
    const box = $('.share-people', root);
    if (!box) return;
    $$('input[name=share]', root).forEach((r) => (r.onchange = () => (box.hidden = $('input[name=share]:checked', root)?.value !== 'some')));
  }
  // Liest die Auswahl; undefined = keine Auswahl im Formular (Cloud aus)
  function read(root) {
    const r = $('input[name=share]:checked', root);
    if (!r) return undefined;
    if (r.value === 'team') return ['*'];
    if (r.value === 'some') return $$('.share-people input:checked', root).map((x) => x.value);
    return [];
  }

  /* ---------- Team-Verwaltung (Seite "Cloud") ---------- */
  function teamCard() {
    if (!on()) return '';
    if (Cloud.state === 'notmember') {
      return `<div class="card"><h3>👥 Team</h3>
        <p class="small warn-text">Du bist noch nicht im Team.</p>
        <p class="small">Bitte jemanden aus dem Team, deine E-Mail <b>${esc(Cloud.myEmail)}</b> unter „Cloud → Team“ hinzuzufügen. Danach siehst du alle Bands und Rider.</p></div>`;
    }
    return `
    <div class="card">
      <h3>👥 Team</h3>
      <p class="small muted">Alle im Team sehen und bearbeiten <b>Bands, Rider und Stagebox-Profile</b>. Konzerte und Festivals sieht nur, wer sie angelegt hat und mit wem sie geteilt sind.</p>
      <ul class="team-list">${Cloud.team.map((e) => `<li><span class="grow">${esc(e)}${e === Cloud.myEmail ? ' <span class="badge">du</span>' : ''}</span>
        ${e === Cloud.myEmail ? '' : `<button class="icon" title="Aus dem Team entfernen" data-rmmember="${esc(e)}">✕</button>`}</li>`).join('')}</ul>
      <form class="inline" data-addmember autocomplete="off">
        <input type="email" name="email" placeholder="E-Mail von Kolleg:in" required>
        <button class="primary">+ Hinzufügen</button>
      </form>
      <p class="muted small">Danach schickst du ihnen den „Link für weiteres Gerät“. Sie legen damit ein Konto mit genau dieser E-Mail an.</p>
    </div>`;
  }
  function bindTeamCard() {
    const f = $('[data-addmember]');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      try { await Cloud.addMember(f.email.value); toast('Zum Team hinzugefügt'); render(); } catch (ex) { toast(ex.message); }
    };
    $$('[data-rmmember]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog(`${esc(b.dataset.rmmember)} aus dem Team entfernen? Die Person sieht danach keine Bands, Rider und Konzerte mehr.`, 'Entfernen', true))) return;
      try { await Cloud.removeMember(b.dataset.rmmember); render(); } catch (ex) { toast(ex.message); }
    }));
  }

  return { defaults, remember, label, badge, picker, bindPicker, read, teamCard, bindTeamCard };
})();
