import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
const ex = promisify(execFile);
const ID = 'aaaaaaaa11111111aaaaaaaa11111111';
const webmap = { operationalLayers: [{ title: 'L1', popupInfo: { expressionInfos: [{ name: 'e1', expression: 'return 1;' }, { name: 'e2', expression: 'return 22;' }, { name: 'e3', expression: 'return 3;' }] } }] };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
  if (u.pathname.endsWith('/generateToken')) { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => res.end(JSON.stringify(/password=pw/.test(b) ? { token: 'T' } : { error: { message: 'Unable to generate token.' } }))); return; }
  if (u.searchParams.get('token') !== 'T') return res.end(JSON.stringify({ error: { message: 'no token' } }));
  if (u.pathname.endsWith(`/items/${ID}/data`)) return res.end(JSON.stringify(webmap));
  if (u.pathname.endsWith(`/items/${ID}`)) return res.end(JSON.stringify({ id: ID, title: 'מפה', type: 'Web Map' }));
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
const hdr = '// ==========================================\n// @name:      X\n// @version:   1.0.0\n// @updated:   2026-01-01\n// ==========================================\n\n';
fs.writeFileSync(path.join(dir, 'a.arcade'), hdr + 'return 1;\n'); fs.writeFileSync(path.join(dir, 'b.arcade'), hdr + 'return 2;\n');
fs.writeFileSync(path.join(dir, 'agol-map.json'), JSON.stringify({ version: 1, items: { [ID]: { title: 'מפה', type: 'Web Map', expressions: [
  { path: 'operationalLayers[0].popupInfo.expressionInfos[0].expression', id: 'popup|L1|e1', file: 'a.arcade' },
  { path: 'operationalLayers[0].popupInfo.expressionInfos[1].expression', id: 'popup|L1|e2', file: 'b.arcade' }] } } }));
fs.writeFileSync(path.join(dir, 'agol-sync.json'), JSON.stringify({ sources: [{ name: 'T', portal: `http://localhost:${port}`, items: [ID] }] }));
const outFile = path.join(dir, 'gh_out.txt'); fs.writeFileSync(outFile, '');
const run = async (secrets) => (await ex('node', ['cli/sync.js', dir], { env: { ...process.env, ALL_SECRETS: JSON.stringify(secrets), GITHUB_OUTPUT: outFile, RUNNER_TEMP: dir }, encoding: 'utf8' })).stdout;
let o;
try { o = await run({ AGOL_T_USERNAME: 'u', AGOL_T_PASSWORD: 'pw' }); } catch (e) { console.error(e.stdout, e.stderr); process.exit(1); }
const g = fs.readFileSync(outFile, 'utf8');
const bad = (m) => { console.error('FAIL', m, '\n', o, g); process.exit(1); };
if (!/changed=true/.test(g) || !/failed=false/.test(g) || !/count=2/.test(g)) bad('outputs');
if (!fs.readFileSync(path.join(dir, 'b.arcade'), 'utf8').includes('return 22;')) bad('b updated');
if (!fs.readFileSync(path.join(dir, 'b.arcade'), 'utf8').startsWith('// ====')) bad('header kept');
const inbox = fs.readdirSync(path.join(dir, '_inbox'), { recursive: true }).filter((f) => f.endsWith('.arcade')); if (inbox.length !== 1) bad('inbox');
const map = JSON.parse(fs.readFileSync(path.join(dir, 'agol-map.json'), 'utf8')); if (map.items[ID].expressions.length !== 3) bad('map');
fs.writeFileSync(outFile, '');
o = await run({ AGOL_T_USERNAME: 'u', AGOL_T_PASSWORD: 'pw' });
if (!/count=0/.test(fs.readFileSync(outFile, 'utf8'))) bad('second run should be clean');
fs.writeFileSync(outFile, '');
o = await run({ AGOL_T_USERNAME: 'u', AGOL_T_PASSWORD: 'wrong' });
if (!/failed=true/.test(fs.readFileSync(outFile, 'utf8')) || o.includes('wrong')) bad('failure handling / secret leak');
srv.close(); console.log('cli ok');
