import { normPortal, generateToken, api, buildItemFiles, buildZip, walk, planSync, updateMap, lineDiff } from './lib.js';
import { getFile, checkRepo, commitFiles } from './gh.js';
const $ = (id) => document.getElementById(id);
let portal = '', token = '', user = '', tokenMode = false;
const PKEY = 'kkl-agol-tools-portals'; // נשמרות כתובות פורטל בלבד, לא פרטי התחברות

const loadPortals = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch { return []; } };
const savePortal = (p) => { try { const l = [p, ...loadPortals().filter((x) => x !== p)].slice(0, 8); localStorage.setItem(PKEY, JSON.stringify(l)); } catch {} };
$('portals').innerHTML = loadPortals().map((p) => `<option value="${p}">`).join('');
const last = loadPortals()[0]; if (last) $('portal').value = last;

const status = (t, cls = '') => { $('cstatus').textContent = t; $('cstatus').className = 'note ' + cls; };
const log = (t, cls = '') => { const d = document.createElement('div'); d.textContent = t; d.className = cls; $('log').appendChild(d); };

$('tokmode').onclick = (e) => {
  e.preventDefault(); tokenMode = !tokenMode;
  $('pass').type = tokenMode ? 'text' : 'password';
  $('pass').placeholder = tokenMode ? 'הדבק טוקן' : '';
  $('tokmode').textContent = tokenMode ? 'חזרה לסיסמה' : 'הדבקת טוקן';
};

$('connect').onclick = async () => {
  portal = normPortal($('portal').value); user = $('user').value.trim();
  const secret = $('pass').value;
  $('connect').disabled = true; status('מתחבר…');
  try {
    token = tokenMode ? secret.trim() : await generateToken(portal, user, secret, location.origin);
    const me = await api(portal, 'community/self', token);
    user = me.username || user;
    $('pass').value = ''; savePortal(portal);
    status(`מחובר: ${user}${me.orgId ? '' : ''}`, 'ok');
    $('pick').hidden = false; $('sync').hidden = false;
  } catch (e) { token = ''; status(e.message, 'err'); }
  $('connect').disabled = false;
};

$('search').onclick = async () => {
  const parts = [];
  if ($('q').value.trim()) parts.push($('q').value.trim());
  if ($('type').value) parts.push($('type').value);
  else parts.push('(type:"Web Map" OR type:"Dashboard" OR type:"Web Experience" OR type:"Web Mapping Application" OR type:"Form")');
  if ($('mine').checked) parts.push(`owner:${user}`);
  $('search').disabled = true;
  try {
    const r = await api(portal, 'search', token, { q: parts.join(' '), num: '100', sortField: 'modified', sortOrder: 'desc' });
    const box = $('results'); box.hidden = false;
    box.innerHTML = r.results.length ? '' : '<div class="it">לא נמצאו פריטים</div>';
    for (const it of r.results) {
      const d = document.createElement('label'); d.className = 'it';
      d.innerHTML = `<input type="checkbox" value="${it.id}"><span class="t"></span><span class="ty"></span>`;
      d.querySelector('.t').textContent = it.title; d.querySelector('.ty').textContent = `${it.type} · ${it.owner}`;
      box.appendChild(d);
    }
  } catch (e) { alert(e.message); }
  $('search').disabled = false;
};

$('export').onclick = async () => {
  const ids = new Set([...document.querySelectorAll('#results input:checked')].map((i) => i.value));
  for (const m of $('ids').value.matchAll(/[0-9a-f]{32}/gi)) ids.add(m[0].toLowerCase());
  if (!ids.size) { alert('לא נבחרו פריטים'); return; }
  $('out').hidden = false; $('log').innerHTML = ''; $('preview').hidden = true;
  $('export').disabled = true;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const files = [], summary = [];
  for (const id of ids) {
    try {
      log(`מוריד ${id}…`);
      const info = await api(portal, `content/items/${id}`, token);
      const data = await api(portal, `content/items/${id}/data`, token);
      const r = buildItemFiles(info, data, stamp);
      files.push(...r.files);
      summary.push({ itemId: id, title: info.title, type: info.type, owner: info.owner, modified: info.modified, expressions: r.count });
      log(`✓ ${info.title} (${info.type}): ${r.count} ביטויים`, 'ok');
      if (r.found.length && $('preview').hidden) { $('preview').hidden = false; $('preview').textContent = r.found[0].expression.slice(0, 1500); }
    } catch (e) { log(`✗ ${id}: ${e.message}`, 'err'); summary.push({ itemId: id, error: e.message }); }
  }
  files.push({ name: 'summary.json', data: JSON.stringify(summary, null, 2) });
  if (summary.some((s) => s.expressions >= 0)) {
    const url = URL.createObjectURL(new Blob([buildZip(files)], { type: 'application/zip' }));
    const a = document.createElement('a'); a.href = url; a.download = `export-${stamp.replace(/[ :]/g, '-')}.zip`; a.click();
    log('ה-zip הורד. את הקובץ מעלים לשיחה עם Claude.', 'ok');
  }
  $('export').disabled = false;
};


// ================= סנכרון מול GitHub =================
let currentPlan = null, currentMap = null, repoCache = {};
const collectIds = () => {
  const ids = new Set([...document.querySelectorAll('#results input:checked')].map((i) => i.value));
  for (const m of $('ids').value.matchAll(/[0-9a-f]{32}/gi)) ids.add(m[0].toLowerCase());
  return ids;
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const STATUS = { same: ['ללא שינוי', 'b-same'], changed: ['שונה ב-AGOL', 'b-changed'], new: ['חדש (לא ממופה)', 'b-new'], 'missing-file': ['הקובץ חסר במאגר', 'b-miss'] };

$('check').onclick = async () => {
  const repo = $('ghrepo').value.trim(), base = $('ghbase').value.trim() || 'main', gt = $('ghtoken').value.trim();
  const ids = collectIds();
  if (!ids.size) { alert('לא נבחרו פריטים בשלב 2'); return; }
  if (!repo || !gt) { alert('חסר מאגר או token'); return; }
  const out = $('syncres'); out.innerHTML = '<div class="note">בודק…</div>'; $('commit').hidden = true; $('commitres').textContent = '';
  $('check').disabled = true;
  try {
    const rc = await checkRepo(repo, gt);
    if (!rc.push) throw new Error('ל-token אין הרשאת כתיבה (Contents: Read and write) למאגר הזה.');
    repoCache = {};
    const read = async (p) => (p in repoCache ? repoCache[p] : (repoCache[p] = await getFile(repo, gt, p, base)));
    const mapText = await read('agol-map.json');
    currentMap = mapText ? JSON.parse(mapText) : { version: 1, items: {} };
    const extracted = [];
    for (const id of ids) {
      const info = await api(portal, `content/items/${id}`, token);
      const data = await api(portal, `content/items/${id}/data`, token);
      const found = []; walk(data, '', info.title, found);
      extracted.push({ info, found });
    }
    currentPlan = await planSync(extracted, currentMap, read, new Date().toISOString().slice(0, 10));
    render();
  } catch (e) { out.innerHTML = ''; const d = document.createElement('div'); d.className = 'err'; d.textContent = e.message; out.appendChild(d); }
  $('check').disabled = false;
};

function render() {
  const out = $('syncres'); out.innerHTML = '';
  let actionable = 0;
  for (const p of currentPlan) {
    const box = document.createElement('div'); box.style.marginTop = '12px';
    const counts = p.rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
    box.innerHTML = `<b>${esc(p.info.title)}</b> <span class="ty">(${esc(p.info.type)})</span> – ` +
      Object.entries(counts).map(([k, v]) => `${STATUS[k][0]}: ${v}`).join(' · ') + (p.mapped ? '' : ' · <span class="err">פריט שלא ממופה במאגר – הכל ייכנס ל-_inbox</span>');
    out.appendChild(box);
    for (const r of p.rows) {
      if (r.status === 'same') continue;
      actionable++;
      const row = document.createElement('div'); row.className = 'sr';
      row.innerHTML = `<input type="checkbox" checked><span class="badge ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span><span>${esc(r.e.context)} · ${esc(r.e.name || r.e.key)}</span><span class="f">${esc(r.file)}</span>`;
      r.cb = row.querySelector('input');
      out.appendChild(row);
      const det = document.createElement('details'); det.className = 'df';
      det.innerHTML = '<summary>הצג הבדלים</summary>';
      const pre = document.createElement('div'); pre.className = 'diff';
      const diff = r.status === 'changed' ? lineDiff(r.repoText, r.e.expression) : r.e.expression.split('\n').slice(0, 40).map((s) => ({ t: '+', s }));
      for (const d of diff) { const sp = document.createElement('div'); sp.className = d.t === '+' ? 'p' : d.t === '-' ? 'm' : d.t === '…' ? 'e' : ''; sp.textContent = d.t === '…' ? '⋯' : d.t + ' ' + d.s; pre.appendChild(sp); }
      det.appendChild(pre); out.appendChild(det);
    }
    if (p.orphans.length) {
      const o = document.createElement('div'); o.className = 'note';
      o.textContent = `במאגר ממופים ${p.orphans.length} קבצים שלא נמצא להם ביטוי בפריט (ייתכן שנמחקו ב-AGOL): ` + p.orphans.map((x) => x.file.split('/').pop()).join(', ');
      out.appendChild(o);
    }
  }
  if (!actionable) { const d = document.createElement('div'); d.className = 'ok'; d.style.marginTop = '10px'; d.textContent = 'אין שינויים: הביטויים ב-AGOL זהים למאגר.'; out.appendChild(d); }
  $('commit').hidden = !actionable;
}

$('commit').onclick = async () => {
  const repo = $('ghrepo').value.trim(), base = $('ghbase').value.trim() || 'main', gt = $('ghtoken').value.trim();
  const files = new Map(); const chosenNew = new Set(); let nChanged = 0, nNew = 0;
  for (const p of currentPlan) for (const r of p.rows) {
    if (!r.cb || !r.cb.checked) continue;
    if (r.status === 'new') {
      chosenNew.add(r); nNew++;
      files.set(r.file, `// @source-item: ${p.info.id} (${p.info.type}) ${p.info.title}\n// @source-path: ${r.e.path}\n// @context:     ${r.e.context}\n// @exported:    ${new Date().toISOString()}\n\n${r.e.expression}\n`);
    } else { nChanged++; files.set(r.file, r.newText); }
  }
  if (!files.size) { alert('לא סומן דבר'); return; }
  if (nNew) files.set('agol-map.json', JSON.stringify(updateMap(currentMap, currentPlan, chosenNew), null, 2) + '\n');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const titles = [...new Set(currentPlan.map((p) => p.info.title))].join(', ');
  const msg = `sync: ${nChanged} ביטויים עודכנו ו-${nNew} חדשים מ-AGOL (${titles})\n\nנשמר ע"י כלי הסנכרון kkl-agol-tools. כדאי לבדוק ולעדכן @version לפני מיזוג.`;
  $('commit').disabled = true; $('commitres').textContent = 'שומר…';
  try {
    const r = await commitFiles(repo, gt, base, `sync/${stamp}`, [...files].map(([path, content]) => ({ path, content })), msg);
    $('commitres').innerHTML = `נשמר בענף <b>${esc(r.branch)}</b>. <a href="${r.url}" target="_blank" rel="noopener">פתיחה להשוואה ויצירת Pull Request</a>`;
  } catch (e) { $('commitres').textContent = 'נכשל: ' + e.message; }
  $('commit').disabled = false;
};
