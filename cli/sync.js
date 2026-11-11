#!/usr/bin/env node
// סנכרון אוטומטי (ל-GitHub Actions): שולף ביטויים מפריטי AGOL, משווה לקבצי המאגר וכותב את השינויים לתיקיית המאגר.
// שימוש: node cli/sync.js <תיקיית-המאגר>
// קלט: <תיקיית-המאגר>/agol-sync.json  +  משתנה סביבה ALL_SECRETS (JSON של secrets, מ-${{ toJSON(secrets) }}).
// לכל מקור בשם NAME נדרשים הסודות AGOL_NAME_USERNAME ו-AGOL_NAME_PASSWORD.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normPortal, generateToken, api, walk, planSync, updateMap, safe } from '../lib.js';

const repoDir = path.resolve(process.argv[2] || '.');
const cfg = JSON.parse(fs.readFileSync(path.join(repoDir, 'agol-sync.json'), 'utf8'));
let secrets = {};
try { secrets = JSON.parse(process.env.ALL_SECRETS || '{}'); } catch { /* ריק */ }
const today = new Date().toISOString().slice(0, 10);
const mapPath = path.join(repoDir, 'agol-map.json');
const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : { version: 1, items: {} };
const readFile = async (p) => { const f = path.join(repoDir, p); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

const lines = []; let failed = false, changedFiles = 0, newFiles = 0;
const allPlans = [];

for (const src of cfg.sources || []) {
  const name = String(src.name || '').toUpperCase();
  const user = secrets[`AGOL_${name}_USERNAME`], pass = secrets[`AGOL_${name}_PASSWORD`];
  if (!user || !pass) { lines.push(`- ❌ **${src.name}**: חסרים הסודות AGOL_${name}_USERNAME / AGOL_${name}_PASSWORD`); failed = true; continue; }
  const portal = normPortal(src.portal);
  let token;
  try { token = await generateToken(portal, user, pass, portal); }
  catch (e) { lines.push(`- ❌ **${src.name}**: התחברות נכשלה (${e.message})`); failed = true; continue; }
  const extracted = [];
  for (const id of src.items || []) {
    try {
      const info = await api(portal, `content/items/${id}`, token);
      const data = await api(portal, `content/items/${id}/data`, token);
      const found = []; walk(data, '', info.title, found);
      extracted.push({ info, found });
    } catch (e) { lines.push(`- ❌ **${src.name}** פריט ${id}: ${e.message}`); failed = true; }
  }
  allPlans.push(...await planSync(extracted, map, readFile, today));
}

const chosenNew = new Set();
for (const p of allPlans) {
  const c = { same: 0, changed: 0, new: 0, 'missing-file': 0 };
  for (const r of p.rows) {
    c[r.status]++;
    const target = path.join(repoDir, r.file);
    if (r.status === 'changed' || r.status === 'missing-file') {
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, r.newText); changedFiles++;
      lines.push(`  - ✏️ \`${r.file}\` (${r.e.context} · ${r.e.name || r.e.key})`);
    } else if (r.status === 'new') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `// @source-item: ${p.info.id} (${p.info.type}) ${p.info.title}\n// @source-path: ${r.e.path}\n// @context:     ${r.e.context}\n// @exported:    ${new Date().toISOString()}\n\n${r.e.expression}\n`);
      chosenNew.add(r); newFiles++;
      lines.push(`  - 🆕 \`${r.file}\` (${r.e.context} · ${r.e.name || r.e.key})`);
    }
  }
  lines.splice(lines.length - (c.changed + c.new + c['missing-file']), 0, `- **${p.info.title}** (${p.info.type}): ללא שינוי ${c.same}, שונו ${c.changed + c['missing-file']}, חדשים ${c.new}`);
  for (const o of p.orphans) lines.push(`  - ⚠️ ממופה ל-\`${o.file}\` אך לא נמצא ביטוי מתאים בפריט (נמחק ב-AGOL?)`);
}
if (newFiles) fs.writeFileSync(mapPath, JSON.stringify(updateMap(map, allPlans, chosenNew), null, 2) + '\n');

const body = `סנכרון אוטומטי מ-AGOL (${today}): **${changedFiles}** קבצים עודכנו, **${newFiles}** חדשים (ב-\`_inbox/\`).\n\n${lines.join('\n')}\n\nכדאי לבדוק את ההבדלים, לעדכן \`@version\` ולמזג.\n`;
const bodyFile = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'sync-summary.md');
fs.writeFileSync(bodyFile, body);
console.log(body.replace(/`/g, ''));
const out = process.env.GITHUB_OUTPUT;
if (out) fs.appendFileSync(out, `changed=${changedFiles + newFiles > 0}\nfailed=${failed}\nbody_path=${bodyFile}\ncount=${changedFiles + newFiles}\n`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
