import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Owner-operated pull deployment. Not reachable by the model, API or public network.
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const revision = process.argv[2] ?? '';
assert.match(revision, /^[a-f0-9]{40}$/, 'Supply one exact approved commit');
assert.equal(
  process.env.AI_DEPLOY_APPROVED,
  'yes',
  'Explicit local deployment approval is required',
);
const approval = JSON.parse(await readFile('ops/approval.json', 'utf8'));
assert.equal(approval.releaseCommit, revision, 'Approval record must name this exact commit');
const git = (args) => execFileSync('git', args, { encoding: 'utf8', timeout: 30000 }).trim();
assert.equal(git(['rev-parse', 'HEAD']), revision, 'Check out the approved revision first');
assert.equal(
  git(['status', '--porcelain', '--untracked-files=no']),
  '',
  'Tracked worktree must be clean',
);
assert(
  [
    'https://github.com/StarShows/alext.io.git',
    'https://github.com/StarShows/alext.io',
    'git@github.com:StarShows/alext.io.git',
  ].includes(git(['remote', 'get-url', 'origin'])),
  'Unexpected repository',
);
git(['fetch', '--no-tags', 'origin', 'main']);
git(['merge-base', '--is-ancestor', revision, 'origin/main']);
const response = await fetch(
  `https://api.github.com/repos/StarShows/alext.io/actions/workflows/ai-ci.yml/runs?head_sha=${revision}&status=success&per_page=50`,
  {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  },
);
assert(response.ok, 'Could not verify CI provenance');
const data = await response.json();
const run = data.workflow_runs?.find(
  (item) =>
    item.head_sha === revision &&
    item.status === 'completed' &&
    item.conclusion === 'success' &&
    item.name === 'AI service CI',
);
assert(run, 'A successful exact-commit AI CI run is required');
const image = `alext-ai-gateway:${revision}`;
assert.equal(
  process.env.GATEWAY_IMAGE,
  image,
  'The local image tag must match the approved commit',
);
const execute = (command, args, env = process.env) =>
  execFileSync(command, args, { stdio: 'inherit', timeout: 900000, env });
execute(process.execPath, ['scripts/preflight.mjs']);
const running = execFileSync('docker', ['compose', 'ps', '--status', 'running', '--services'], {
  encoding: 'utf8',
  timeout: 10000,
});
assert(
  running.split('\n').includes('ollama') && running.split('\n').includes('tunnel'),
  'Initial infrastructure must already be approved and running',
);
let previous = null;
try {
  previous = (await readFile('.state/current-image', 'utf8')).trim();
} catch {
  /* Initial deployment has no automatic rollback target. */
}
if (previous) {
  assert.match(previous, /^alext-ai-gateway:[a-f0-9]{40}$/);
  execFileSync('docker', ['image', 'inspect', previous], { stdio: 'ignore', timeout: 10000 });
}
execute('npm', ['ci', '--ignore-scripts', '--no-fund']);
execute('npm', ['test']);
execute('npm', ['run', 'lint']);
execute('docker', ['compose', 'build', 'gateway']);
try {
  execute('docker', [
    'compose',
    'up',
    '-d',
    '--no-deps',
    '--no-build',
    '--wait',
    '--wait-timeout',
    '90',
    'gateway',
  ]);
} catch (error) {
  if (previous && approval.rollbackOnReadinessFailure === true)
    execute(
      'docker',
      [
        'compose',
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        '--wait',
        '--wait-timeout',
        '90',
        'gateway',
      ],
      { ...process.env, GATEWAY_IMAGE: previous },
    );
  throw error;
}
await mkdir('.state', { recursive: true, mode: 0o700 });
await writeFile('.state/current-image', image + '\n', { mode: 0o600 });
await writeFile(
  '.state/deployment.json',
  JSON.stringify(
    {
      revision,
      image,
      previous,
      ciRun: run.id,
      time: new Date().toISOString(),
      status: 'gateway-ready-public-acceptance-still-required',
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  'Approved gateway update completed. Verify real chat externally; readiness is not production acceptance.',
);
