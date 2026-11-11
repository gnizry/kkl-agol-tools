import { commitFiles, getFile } from '../gh.js';
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const m = opts.method || 'GET'; calls.push(`${m} ${url.replace('https://api.github.com', '')}`);
  const ok = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => 'raw' });
  if (url.includes('/git/ref/heads/')) return ok({ object: { sha: 'BASE' } });
  if (url.includes('/git/commits/BASE')) return ok({ tree: { sha: 'TREE0' } });
  if (url.includes('/git/blobs')) return ok({ sha: 'B' + calls.length });
  if (url.includes('/git/trees')) { const b = JSON.parse(opts.body); if (b.base_tree !== 'TREE0' || b.tree.length !== 2) throw new Error('tree body'); return ok({ sha: 'TREE1' }); }
  if (url.endsWith('/git/commits')) { const b = JSON.parse(opts.body); if (b.parents[0] !== 'BASE') throw new Error('parents'); return ok({ sha: 'C1' }); }
  if (url.endsWith('/git/refs')) { const b = JSON.parse(opts.body); if (b.ref !== 'refs/heads/sync/x' || b.sha !== 'C1') throw new Error('ref'); return ok({}); }
  if (url.includes('/contents/')) return url.includes('missing') ? { ok: false, status: 404 } : ok({});
  throw new Error('unexpected ' + url);
};
const r = await commitFiles('o/r', 't', 'main', 'sync/x', [{ path: 'projects/א/b.arcade', content: 'x' }, { path: 'agol-map.json', content: '{}' }], 'msg');
if (!r.url.endsWith('main...sync%2Fx')) throw new Error('url ' + r.url);
if ((await getFile('o/r', 't', 'missing.arcade', 'main')) !== null) throw new Error('404 should be null');
console.log('gh ok', calls.length);
