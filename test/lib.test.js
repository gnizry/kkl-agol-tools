import { walk, classify, buildItemFiles, buildZip, scrub } from '../lib.js';
import { writeFileSync } from 'node:fs';
const web = { operationalLayers: [{ title: 'התקשרויות', url: 'https://x/FS/0?token=SECRET',
  popupInfo: { expressionInfos: [{ name: 'e0', title: 'פופאפ', expression: 'return 1;', returnType: 'string' }] },
  layerDefinition: { definitionExpression: 'A=1', drawingInfo: { labelingInfo: [{ labelExpressionInfo: { expression: '$feature.A' } }], renderer: { valueExpression: '$feature.B' } } },
  formInfo: { expressionInfos: [{ name: 'calc', expression: 'return 2;' }] } }] };
const dash = { widgets: [{ type: 'listWidget', name: 'רשימה' }], dataSources: [{ id: 'd1', name: 'מוקד', type: 'expression', script: 'var x = FeatureSetByPortalItem(Portal("x"),"y",0); return x;' }, { id: 'd2', script: 'nothing' }] };
const a = buildItemFiles({ id: 'abcdef1234567890abcdef1234567890', title: 'מפה', type: 'Web Map' }, web, 'now');
const b = buildItemFiles({ id: '1234567890abcdef1234567890abcdef', title: 'דשבורד', type: 'Dashboard' }, dash, 'now');
console.log(a.count, b.count, a.found.map((e) => classify(e.path)).join(','), b.found.map((e) => classify(e.path)).join(','));
if (a.count !== 4 || b.count !== 1) { console.error('FAIL counts'); process.exit(1); }
if (JSON.stringify(a.files).includes('SECRET')) { console.error('FAIL token leak'); process.exit(1); }
writeFileSync('/tmp/t.zip', buildZip([...a.files, ...b.files]));
console.log('ok');
