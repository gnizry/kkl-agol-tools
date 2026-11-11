// GitHub REST מהדפדפן עם Personal Access Token (נשמר בזיכרון הדף בלבד)
const API = 'https://api.github.com';
const H = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...extra });
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function j(r) {
  if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch {} throw new Error(`GitHub ${r.status}: ${m || r.statusText}`); }
  return r.json();
}

export async function getFile(repo, token, path, ref) {
  const r = await fetch(`${API}/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, { headers: H(token, { Accept: 'application/vnd.github.raw+json' }) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} (${path})`);
  return r.text();
}

export async function checkRepo(repo, token) {
  const info = await j(await fetch(`${API}/repos/${repo}`, { headers: H(token) }));
  return { push: !!(info.permissions && info.permissions.push), private: info.private, default_branch: info.default_branch };
}

// commit אחד עם כמה קבצים, לענף חדש שנוצר מ-base. מחזיר שם ענף וקישור להשוואה.
export async function commitFiles(repo, token, base, branch, files, message) {
  const ref = await j(await fetch(`${API}/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`, { headers: H(token) }));
  const baseSha = ref.object.sha;
  const baseCommit = await j(await fetch(`${API}/repos/${repo}/git/commits/${baseSha}`, { headers: H(token) }));
  const tree = [];
  for (const f of files) {
    const blob = await j(await fetch(`${API}/repos/${repo}/git/blobs`, { method: 'POST', headers: H(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ content: f.content, encoding: 'utf-8' }) }));
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await j(await fetch(`${API}/repos/${repo}/git/trees`, { method: 'POST', headers: H(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) }));
  const commit = await j(await fetch(`${API}/repos/${repo}/git/commits`, { method: 'POST', headers: H(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }) }));
  await j(await fetch(`${API}/repos/${repo}/git/refs`, { method: 'POST', headers: H(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) }));
  return { branch, url: `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}` };
}
