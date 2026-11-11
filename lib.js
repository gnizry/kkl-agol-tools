// לוגיקה משותפת: שליפת ביטויי Arcade מ-JSON של פריט, ויצירת קובץ zip (ללא תלויות).
const EXPR_KEYS = new Set(['expression', 'valueExpression', 'arcadeExpression', 'script', 'arcadeScript']);
const TITLE_KEYS = ['title', 'name', 'label', 'id'];
const CTX_HINT = ['popupInfo', 'layerDefinition', 'formInfo', 'url', 'type', 'widgetName'];

export function scrub(o) {
  if (typeof o === 'string') return o.replace(/([?&]token=)[^&\s"']+/g, '$1REDACTED');
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scrub(v)]));
  return o;
}

export function walk(node, path, ctx, out) {
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, ctx, out)); return; }
  if (!node || typeof node !== 'object') return;
  for (const tk of TITLE_KEYS) {
    if (typeof node[tk] === 'string' && node[tk]) {
      if (CTX_HINT.some((k) => k in node)) ctx = node[tk];
      break;
    }
  }
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (EXPR_KEYS.has(k) && typeof v === 'string' && v.trim()) {
      // רעש: מפת הבסיס של Esri, מצביעי טופס (expr/...), ביטויי מערכת טריוויאליים
      if (p.startsWith('baseMap.')) continue;
      if (k === 'valueExpression' && p.includes('formElements') && /^expr\//.test(v.trim())) continue;
      if (/^(true|false|\$view\.scale)$/.test(v.trim())) continue;
      // "script" נספר רק אם נראה כמו Arcade (למנוע רעש)
      if (k === 'script' && !/(\breturn\b|\bvar\b|\$|FeatureSet|Portal)/.test(v)) continue;
      out.push({ path: p, context: ctx, key: k, name: node.name || node.title || '', returnType: node.returnType || '', expression: v });
    } else walk(v, p, ctx, out);
  }
}

export function classify(path) {
  const p = path.toLowerCase();
  if (p.includes('labelexpressioninfo') || p.includes('labelinginfo')) return 'label';
  if (p.includes('popupinfo')) return 'popup';
  if (p.includes('forminfo')) return 'form';
  if (p.includes('visualvariables') || p.includes('renderer')) return 'renderer';
  if (p.endsWith('.script') || p.endsWith('.arcadescript') || p.includes('datasources')) return 'data-expression';
  return 'other';
}

export const safe = (s, n = 60) => (String(s || '').replace(/[^\w֐-׿-]+/g, '_').replace(/^_+|_+$/g, '') || 'x').slice(0, n);

// בונה קבצים לפריט אחד: [{name, data}] + ספירה
export function buildItemFiles(info, data, stamp) {
  const iid = info.id;
  const dir = `${safe(info.title || iid)}_${iid.slice(0, 8)}`;
  const found = [];
  walk(data, '', info.title || iid, found);
  const used = {};
  const files = [
    { name: `${dir}/item.json`, data: JSON.stringify(scrub(info), null, 2) },
    { name: `${dir}/data.json`, data: JSON.stringify(scrub(data), null, 2) },
    { name: `${dir}/expressions.json`, data: JSON.stringify(scrub(found), null, 2) },
  ];
  for (const e of found) {
    const kind = classify(e.path);
    const base = `${kind}__${safe(e.context)}__${safe(e.name)}`;
    used[base] = (used[base] || 0) + 1;
    const fname = `${base}${used[base] > 1 ? '_' + used[base] : ''}.arcade`;
    const header = `// @source-item: ${iid} (${info.type || ''}) ${info.title || ''}\n// @source-path: ${e.path}\n// @context:     ${e.context}\n// @kind:        ${kind}   @returnType: ${e.returnType}\n// @exported:    ${stamp}\n\n`;
    files.push({ name: `${dir}/expressions/${fname}`, data: header + scrub(e.expression) + '\n' });
  }
  return { files, count: found.length, found };
}

// ---- zip (store, UTF-8 names) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function buildZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---- ArcGIS REST ----
export const normPortal = (u) => {
  u = (u || '').trim().replace(/\/+$/, '').replace(/\/(home|sharing).*$/i, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u || 'https://www.arcgis.com';
};

export async function generateToken(portal, username, password, referer) {
  const body = new URLSearchParams({ username, password, client: 'referer', referer, expiration: '60', f: 'json' });
  let j;
  try { j = await (await fetch(portal + '/sharing/rest/generateToken', { method: 'POST', body })).json(); }
  catch { throw new Error('לא ניתן להגיע לפורטל (כתובת שגויה או חסימת CORS).'); }
  if (!j.token) throw new Error(j.error?.message === 'Unable to generate token.' ? 'שם משתמש או סיסמה שגויים (או שהחשבון משתמש ב-SSO).' : (j.error?.message || 'ההתחברות נכשלה.'));
  return j.token;
}

export async function api(portal, path, token, params = {}) {
  const qs = new URLSearchParams({ f: 'json', token, ...params });
  const r = await fetch(`${portal}/sharing/rest/${path}?${qs}`);
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j;
}

// ================= סנכרון מול GitHub =================
export const normText = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();

// כותרת תיעוד של המאגר: בלוק שנפתח ב-// ==== ומכיל @name, ונסגר ב-// ====
export function splitHeader(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  // כותרת של כלי הייצוא (קבצי _inbox): שורות // @source-... עד השורה הריקה הראשונה
  if (/^\/\/ @source-item:/.test(lines[0] || '')) {
    let k = 0; while (k < lines.length && /^\/\/ ?@/.test(lines[k])) k++;
    return { header: lines.slice(0, k).join('\n'), body: lines.slice(k).join('\n').replace(/^\n+/, '') };
  }
  if (!/^\/\/ ?=+\s*$/.test(lines[0] || '')) return { header: '', body: t };
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (/^\/\/ ?=+\s*$/.test(lines[i])) { end = i; break; }
  if (end < 0) return { header: '', body: t };
  const header = lines.slice(0, end + 1).join('\n');
  if (!/@name:/.test(header)) return { header: '', body: t };
  return { header, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

export function sameExpr(agolText, repoText) {
  const a = normText(agolText);
  if (a === normText(repoText)) return true;
  return a === normText(splitHeader(repoText).body);
}

// קובץ חדש לתוכן שהשתנה ב-AGOL: שומר את כותרת המאגר, מעדכן @updated
export function buildUpdatedFile(agolText, repoText, today) {
  const ag = String(agolText).replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n';
  if (splitHeader(ag).header) return ag; // הביטוי ב-AGOL כבר כולל כותרת משלו
  const { header } = splitHeader(repoText);
  if (!header) return ag;
  const h = header.includes('@updated:') ? header.replace(/(\/\/ @updated:\s*).*/, `$1${today}`) : header;
  return h + '\n\n' + ag;
}

export function lineDiff(aText, bText, ctx = 3) {
  const a = normText(aText).split('\n'), b = normText(bText).split('\n');
  const n = a.length, m = b.length;
  if (n * m > 9e6) return [{ t: ' ', s: `(קובץ גדול מדי להצגת הבדלים: ${n} מול ${m} שורות)` }];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ t: '-', s: a[i++] }); }
    else { out.push({ t: '+', s: b[j++] }); }
  }
  while (i < n) out.push({ t: '-', s: a[i++] });
  while (j < m) out.push({ t: '+', s: b[j++] });
  // השארת הקשר סביב שינויים בלבד
  const keep = new Array(out.length).fill(false);
  out.forEach((o, k) => { if (o.t !== ' ') for (let x = Math.max(0, k - ctx); x <= Math.min(out.length - 1, k + ctx); x++) keep[x] = true; });
  const res = []; let skipped = false;
  out.forEach((o, k) => { if (keep[k]) { res.push(o); skipped = false; } else if (!skipped) { res.push({ t: '…', s: '' }); skipped = true; } });
  return res;
}

export const exprId = (e) => `${classify(e.path)}|${e.context}|${e.name}`;

// extracted: [{info, found}] ; map: {items:{id:{expressions:[{path,id,file}]}}} ; readFile: path -> Promise<string|null>
export async function planSync(extracted, map, readFile, today) {
  const plan = [];
  for (const { info, found } of extracted) {
    const entry = (map.items || {})[info.id];
    const list = entry ? entry.expressions : [];
    const usedFiles = new Set();
    const rows = [];
    const dirSlug = `${safe(info.title || info.id)}_${info.id.slice(0, 8)}`;
    const newCount = {};
    for (const e of found) {
      const id = exprId(e);
      const m = list.find((x) => x.path === e.path) || list.find((x) => x.id === id && !usedFiles.has(x.file + '|' + x.path));
      if (m) {
        usedFiles.add(m.file + '|' + m.path);
        const repoText = await readFile(m.file);
        if (repoText == null) { rows.push({ status: 'missing-file', e, file: m.file, newText: buildUpdatedFile(e.expression, '', today) }); continue; }
        if (sameExpr(e.expression, repoText)) rows.push({ status: 'same', e, file: m.file });
        else rows.push({ status: 'changed', e, file: m.file, repoText, newText: buildUpdatedFile(e.expression, repoText, today) });
      } else {
        const base = `${classify(e.path)}__${safe(e.context)}__${safe(e.name)}`;
        newCount[base] = (newCount[base] || 0) + 1;
        const file = `_inbox/${dirSlug}/${base}${newCount[base] > 1 ? '_' + newCount[base] : ''}.arcade`;
        rows.push({ status: 'new', e, file, id });
      }
    }
    const seen = new Set(found.map((e) => e.path));
    const seenIds = new Set(found.map(exprId));
    const orphans = list.filter((x) => !seen.has(x.path) && !seenIds.has(x.id));
    plan.push({ info, rows, orphans, mapped: !!entry });
  }
  return plan;
}

// הוספת רשומות חדשות ל-agol-map.json
export function updateMap(map, plan, chosenNew) {
  const out = JSON.parse(JSON.stringify(map || { version: 1, items: {} }));
  out.items = out.items || {};
  for (const p of plan) {
    for (const r of p.rows) {
      if (r.status !== 'new' || !chosenNew.has(r)) continue;
      const it = (out.items[p.info.id] ||= { title: p.info.title, type: p.info.type, expressions: [] });
      it.expressions.push({ path: r.e.path, id: r.id, file: r.file });
    }
  }
  return out;
}
