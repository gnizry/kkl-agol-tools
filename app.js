import { normPortal, generateToken, api, buildItemFiles, buildZip } from './lib.js';
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
    $('pick').hidden = false;
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
