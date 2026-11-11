import { planSync, splitHeader, sameExpr, buildUpdatedFile, lineDiff, updateMap } from '../lib.js';
const hdr = '// ==========================================\n// @name:      X\n// @version:   1.0.0\n// @updated:   2026-01-01\n// ==========================================\n\n';
const repo = { 'a.arcade': hdr + 'return 1;\n', 'b.arcade': hdr + 'return 2;\n', 'c.arcade': 'var x = 1;\nreturn x;\n' };
const readFile = async (p) => repo[p] ?? null;
const found = [
  { path: 'x.expression', context: 'L1', name: 'e1', expression: 'return 1;', key: 'expression' },
  { path: 'y.expression', context: 'L2', name: 'e2', expression: 'return 22;', key: 'expression' },
  { path: 'z.expression', context: 'L3', name: 'e3', expression: 'var x = 1;\r\nreturn x;  \r\n', key: 'expression' },
  { path: 'n.expression', context: 'L4', name: 'e4', expression: 'return 4;', key: 'expression' },
];
const map = { items: { aaaaaaaa11111111aaaaaaaa11111111: { expressions: [
  { path: 'x.expression', id: 'other|L1|e1', file: 'a.arcade' }, { path: 'y.expression', id: 'other|L2|e2', file: 'b.arcade' },
  { path: 'z.expression', id: 'other|L3|e3', file: 'c.arcade' }, { path: 'gone.expression', id: 'other|G|g', file: 'b.arcade' }] } } };
const plan = await planSync([{ info: { id: 'aaaaaaaa11111111aaaaaaaa11111111', title: 'T', type: 'Web Map' }, found }], map, readFile, '2026-11-11');
const st = plan[0].rows.map((r) => r.status).join(',');
const bad = (m) => { console.error('FAIL', m); process.exit(1); };
if (st !== 'same,changed,same,new') bad('statuses ' + st);
if (plan[0].orphans.length !== 1) bad('orphans');
const ch = plan[0].rows[1];
if (!ch.newText.includes('@updated:   2026-11-11') || !ch.newText.includes('return 22;') || !ch.newText.startsWith('// ====')) bad('updated file\n' + ch.newText);
if (!plan[0].rows[3].file.startsWith('_inbox/')) bad('inbox');
const d = lineDiff('a\nb\nc', 'a\nB\nc'); if (!d.some((x) => x.t === '-' && x.s === 'b') || !d.some((x) => x.t === '+' && x.s === 'B')) bad('diff');
if (!sameExpr(hdr + 'return 1;', repo['a.arcade'])) bad('header-in-agol');
const m2 = updateMap(map, plan, new Set([plan[0].rows[3]])); if (m2.items.aaaaaaaa11111111aaaaaaaa11111111.expressions.length !== 5) bad('updateMap');
console.log('sync ok');
