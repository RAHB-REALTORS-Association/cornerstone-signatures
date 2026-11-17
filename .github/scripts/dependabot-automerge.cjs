// Adapted from the verified-commit gates in wav-maker and selenium-screenshots.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const ACTIONS_APP = 15368;
const CODEQL_APP = 57789;
const FINISHED = new Set(['success', 'neutral', 'skipped']);
const GROUP = /^dependabot\/(npm_and_yarn|github_actions|docker)\/patch-and-minor(?:-security)?-[a-z0-9]+$/;
const sameRepo = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

function api(method, endpoint, fields = {}) {
  const args = ['api', '--method', method, endpoint];
  const options = { encoding: 'utf8' };
  if (Object.keys(fields).length) {
    args.push('--input', '-');
    options.input = JSON.stringify(fields);
  }
  try {
    const output = execFileSync('gh', args, options);
    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    const status = /HTTP (405|409|422)\b/.exec(String(error.stderr || ''));
    if (status) error.status = Number(status[1]);
    throw error;
  }
}

async function pages(call, endpoint, key) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await call('GET', `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const batch = key ? result[key] : result;
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub pagination result');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function eligible(pr, repository, branch, sha) {
  return pr.state === 'open' && !pr.draft && !pr.merged &&
    pr.user?.login === 'dependabot[bot]' && pr.user?.type === 'Bot' &&
    sameRepo(pr.head?.repo?.full_name, repository) && sameRepo(pr.base?.repo?.full_name, repository) &&
    pr.base.ref === branch && GROUP.test(pr.head.ref) &&
    !pr.head.ref.startsWith('dependabot/docker/patch-and-minor-security-') && pr.head.sha === sha;
}

function version(value, full = false) {
  const match = (full ? /^(\d+)\.(\d+)\.(\d+)$/ : /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/).exec(value);
  return match ? match.slice(1).map(n => Number(n || 0)) : null;
}

function nonMajor(before, after, full = false) {
  const a = version(before, full), b = version(after, full);
  return Boolean(a && b && a[0] === b[0] &&
    (b[1] > a[1] || (b[1] === a[1] && b[2] >= a[2])));
}

function npmPinsOnly(before, after) {
  const a = JSON.parse(before), b = JSON.parse(after);
  let changed = false;
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const oldPins = a[section] || {}, newPins = b[section] || {};
    if (!isDeepStrictEqual(Object.keys(oldPins).sort(), Object.keys(newPins).sort())) return false;
    for (const [name, pin] of Object.entries(oldPins)) {
      if (!nonMajor(pin, newPins[name], true)) return false;
      changed ||= pin !== newPins[name];
    }
    delete a[section];
    delete b[section];
  }
  return changed && isDeepStrictEqual(a, b);
}

function validLock(before, after, manifest) {
  const oldLock = JSON.parse(before), lock = JSON.parse(after), pkg = JSON.parse(manifest);
  if (lock.lockfileVersion !== oldLock.lockfileVersion || lock.name !== pkg.name ||
      lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) return false;
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!isDeepStrictEqual(lock.packages[''][section] || {}, pkg[section] || {})) return false;
  }
  return Object.entries(lock.packages).every(([path, dependency]) => {
    if (!path) return true;
    if (dependency.link || !dependency.resolved || !dependency.integrity) return false;
    const url = new URL(dependency.resolved);
    return url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^sha(?:512|256|1)-[A-Za-z0-9+/=]+$/.test(dependency.integrity);
  });
}

function lockPinsOnly(before, after) {
  const a = JSON.parse(before).packages, b = JSON.parse(after).packages;
  if (!isDeepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort()) || !isDeepStrictEqual(a[''], b[''])) return false;
  let changed = false;
  for (const path of Object.keys(a).filter(path => path)) {
    if (!nonMajor(a[path].version, b[path].version, true)) return false;
    changed ||= a[path].version !== b[path].version;
  }
  return changed;
}

function actionsVersionsOnly(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  if (a.length !== b.length) return false;
  let changed = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const pattern = /^(\s*(?:-\s*)?uses:\s*)([\w./-]+)@([^\s#]+)(.*)$/;
    const oldUse = pattern.exec(a[i]), newUse = pattern.exec(b[i]);
    if (!oldUse || !newUse || oldUse[1] !== newUse[1] || oldUse[2] !== newUse[2] ||
        oldUse[4] !== newUse[4] || !nonMajor(oldUse[3], newUse[3])) return false;
    changed = true;
  }
  return changed;
}

function imageReference(value) {
  const match = /^([\w./-]+):(\d+(?:\.\d+){0,2})(-[\w.-]+)?(?:@sha256:[a-f0-9]{64})?$/.exec(value);
  return match && { image: match[1], version: match[2], channel: match[3] || '' };
}

function dockerVersionsOnly(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  if (a.length !== b.length) return false;
  let changed = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const pattern = /^(\s*FROM\s+)(\S+)(.*)$/;
    const oldLine = pattern.exec(a[i]), newLine = pattern.exec(b[i]);
    if (!oldLine || !newLine || oldLine[1] !== newLine[1] || oldLine[3] !== newLine[3]) return false;
    const oldImage = imageReference(oldLine[2]), newImage = imageReference(newLine[2]);
    if (!oldImage || !newImage || oldImage.image !== newImage.image ||
        oldImage.channel !== newImage.channel || !nonMajor(oldImage.version, newImage.version)) return false;
    changed = true;
  }
  return changed;
}

async function filesAllowed(call, root, pr) {
  const ecosystem = GROUP.exec(pr.head.ref)[1];
  const files = await pages(call, `${root}/pulls/${pr.number}/files`);
  if (!files.length || files.some(file => file.status !== 'modified')) return false;
  async function content(path, ref) {
    const data = await call('GET', `${root}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (data.type !== 'file' || data.encoding !== 'base64' || data.size > 3_000_000) throw new Error('Unexpected dependency file');
    return Buffer.from(data.content, 'base64').toString('utf8');
  }
  const texts = new Map();
  for (const file of files) {
    const allowed = ecosystem === 'npm_and_yarn' ? ['package.json', 'package-lock.json'].includes(file.filename) :
      ecosystem === 'docker' ? file.filename === 'Dockerfile' :
        /^\.github\/workflows\/(ci|docker|pages|release)\.yml$/.test(file.filename);
    if (!allowed) return false;
    texts.set(file.filename, await Promise.all([content(file.filename, pr.base.sha), content(file.filename, pr.head.sha)]));
  }
  if (ecosystem === 'npm_and_yarn') {
    if (!texts.has('package-lock.json')) return false;
    if (texts.has('package.json')) {
      return npmPinsOnly(...texts.get('package.json')) &&
        validLock(...texts.get('package-lock.json'), texts.get('package.json')[1]);
    }
    const manifest = await content('package.json', pr.head.sha);
    return lockPinsOnly(...texts.get('package-lock.json')) && validLock(...texts.get('package-lock.json'), manifest);
  }
  return [...texts.values()].every(pair => (ecosystem === 'docker' ? dockerVersionsOnly : actionsVersionsOnly)(...pair));
}

function checksReady(checks, statuses, sha) {
  const required = ['test (24)', 'test (26)'];
  if (!required.every(name => checks.some(check => check.name === name && check.app?.id === ACTIONS_APP &&
      check.head_sha === sha && check.status === 'completed' && check.conclusion === 'success'))) return false;
  // Dependency-only PRs may receive a neutral CodeQL result when no analysis is applicable.
  if (!checks.some(check => check.name === 'CodeQL' && check.app?.id === CODEQL_APP &&
      check.head_sha === sha && check.status === 'completed' && ['success', 'neutral'].includes(check.conclusion))) return false;
  return checks.every(check => check.head_sha === sha && check.status === 'completed' && FINISHED.has(check.conclusion)) &&
    statuses.every(status => status.state === 'success');
}

async function autoMerge(event, call = api, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const run = event.workflow_run;
  const repository = event.repository.full_name, branch = event.repository.default_branch;
  if (run?.event !== 'pull_request' || run.conclusion !== 'success' ||
      !sameRepo(run.head_repository?.full_name, repository)) return;
  const root = `repos/${repository}`, owner = repository.split('/')[0];
  const candidates = await pages(call, `${root}/pulls?state=open&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`);
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const pr = await call('GET', `${root}/pulls/${candidate.number}`);
      if (!eligible(pr, repository, branch, run.head_sha)) break;
      if (!await filesAllowed(call, root, pr)) {
        console.log(`PR #${pr.number} requires manual review: changes exceed dependency version updates.`);
        break;
      }
      const checks = await pages(call, `${root}/commits/${run.head_sha}/check-runs?filter=latest`, 'check_runs');
      const history = await pages(call, `${root}/commits/${run.head_sha}/statuses`);
      const latest = [...new Map(history.slice().reverse().map(status => [status.context, status])).values()];
      if (checksReady(checks, latest, run.head_sha)) {
        const current = await call('GET', `${root}/pulls/${pr.number}`);
        if (!eligible(current, repository, branch, run.head_sha) || current.base.sha !== pr.base.sha) break;
        if (current.mergeable === true && current.mergeable_state === 'clean') {
          let merged;
          try {
            merged = await call('PUT', `${root}/pulls/${pr.number}/merge`, { sha: run.head_sha, merge_method: 'squash' });
          } catch (error) {
            // Branch protections, reviews, or a racing update must remain authoritative.
            if ([405, 409, 422].includes(error.status)) return;
            throw error;
          }
          if (!merged?.merged) throw new Error(`GitHub did not merge PR #${pr.number}`);
          console.log(`Merged Dependabot PR #${pr.number} at ${run.head_sha}`);
          // Token-authenticated merges do not trigger push workflows. Recheck main
          // explicitly; publishing remains a separate tagged release operation.
          await call('POST', `${root}/actions/workflows/ci.yml/dispatches`, {
            ref: branch,
          });
          return;
        }
        if (!['unknown', 'unstable'].includes(current.mergeable_state)) return;
      }
      if (checks.some(check => check.status === 'completed' && !FINISHED.has(check.conclusion)) ||
          latest.some(status => ['error', 'failure'].includes(status.state))) return;
      if (attempt === 19) throw new Error(`Timed out waiting for checks on PR #${pr.number}`);
      await wait(15000);
    }
  }
}

if (require.main === module) {
  autoMerge(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { autoMerge, eligible, filesAllowed, npmPinsOnly, validLock, lockPinsOnly, actionsVersionsOnly, dockerVersionsOnly, checksReady };
