import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { statfsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Image preparation only. This script never creates or starts a container.
export const repository = 'ollama/ollama';
export const version = '0.40.4';
const GiB = 1024 ** 3;
const maxCompressedBytes = 2 * GiB;
const minimumFreeBefore = 20 * GiB;
const minimumFreeAfter = 12 * GiB;

export function selectArm64(index) {
  assert(Array.isArray(index.manifests), 'Expected a multi-platform image index');
  const matches = index.manifests.filter((entry) => {
    const platform = entry.platform;
    return (
      platform?.os === 'linux' &&
      platform.architecture === 'arm64' &&
      (!platform.variant || platform.variant === 'v8')
    );
  });
  assert.equal(matches.length, 1, 'Expected exactly one Linux ARM64 image');
  const digest = matches[0].digest;
  assert.match(digest, /^sha256:[a-f0-9]{64}$/, 'Invalid image digest');
  return digest;
}

export function compressedSize(manifest) {
  assert.equal(manifest.schemaVersion, 2, 'Unsupported image manifest');
  assert(Array.isArray(manifest.layers) && manifest.layers.length > 0, 'Missing image layers');
  const parts = [...manifest.layers, manifest.config];
  let total = 0;
  for (const part of parts) {
    assert(part && Number.isSafeInteger(part.size) && part.size > 0, 'Invalid layer size');
    assert.match(part.digest, /^sha256:[a-f0-9]{64}$/, 'Invalid layer digest');
    total += part.size;
    assert(Number.isSafeInteger(total), 'Image size overflow');
  }
  assert(total <= maxCompressedBytes, 'Image exceeds the 2 GiB compressed-download guard');
  return total;
}

function run(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function inspectRegistryImage(command = run) {
  const tag = `${repository}:${version}`;
  const index = JSON.parse(command(['buildx', 'imagetools', 'inspect', '--raw', tag]));
  const digest = selectArm64(index);
  const reference = `${repository}@${digest}`;
  const manifest = JSON.parse(command(['buildx', 'imagetools', 'inspect', '--raw', reference]));
  return {
    tag,
    reference,
    platform: 'linux/arm64',
    compressedBytes: compressedSize(manifest),
    inspectedAt: new Date().toISOString(),
    note: 'Registry metadata only. This is not an inference benchmark or uncompressed disk usage.',
  };
}

function freeBytes() {
  const stats = statfsSync('/System/Volumes/Data', { bigint: true });
  return Number(stats.bavail * stats.bsize);
}

export function verifyLocalEndpoint(endpoint) {
  assert(typeof endpoint === 'string', 'Missing Docker endpoint');
  assert(endpoint.startsWith('unix:///'), 'Refusing a remote Docker endpoint');
}

async function prepare() {
  assert.equal(process.platform, 'darwin', 'Run preparation on the approved Mac mini');
  assert.equal(process.arch, 'arm64', 'Run with native Apple Silicon Node, not Rosetta');
  const context = run(['context', 'show']);
  const details = JSON.parse(run(['context', 'inspect', context]));
  verifyLocalEndpoint(details[0]?.Endpoints?.docker?.Host);
  const docker = ['--context', context];
  const runtime = run([...docker, 'info', '--format', '{{.OSType}}/{{.Architecture}}']);
  assert(['linux/aarch64', 'linux/arm64'].includes(runtime), 'Expected a local ARM64 Docker VM');
  const freeBefore = freeBytes();
  assert(freeBefore >= minimumFreeBefore, 'Stop: fewer than 20 GiB available on the Mac data volume');
  const metadata = inspectRegistryImage((args) => run([...docker, ...args]));
  console.log(JSON.stringify(metadata, null, 2));
  console.log(`Mac free space before pull: ${(freeBefore / GiB).toFixed(2)} GiB`);
  console.log('Pulling only the pinned ARM64 image. No model or container is started.');
  console.log('Compressed size is not installed size; post-pull disk checks follow.');
  await new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [...docker, 'pull', '--platform', 'linux/arm64', metadata.reference],
      { stdio: 'inherit', timeout: 30 * 60 * 1000 },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker pull did not complete (code=${code}, signal=${signal})`));
    });
  });
  const [image] = JSON.parse(run([...docker, 'image', 'inspect', metadata.reference]));
  assert.equal(image.Os, 'linux', 'Pulled image OS mismatch');
  assert.equal(image.Architecture, 'arm64', 'Pulled image architecture mismatch');
  assert(image.RepoDigests?.includes(metadata.reference), 'Pulled image digest mismatch');
  assert(Number.isSafeInteger(image.Size) && image.Size > 0, 'Missing installed image size');
  const freeAfter = freeBytes();
  const result = {
    ...metadata,
    status: freeAfter >= minimumFreeAfter ? 'image-prepared' : 'stop-low-disk',
    imageId: image.Id,
    installedImageBytes: image.Size,
    macFreeBeforeBytes: freeBefore,
    macFreeAfterBytes: freeAfter,
    modelDownloaded: false,
    containersStarted: false,
    inferenceRun: false,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = join(homedir(), 'Downloads', `alext-benchmark-image-${stamp}.json`);
  writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log('\n== Preparation summary ==');
  console.log(JSON.stringify(result, null, 2));
  console.log(`Report saved to ${report}`);
  assert(freeAfter >= minimumFreeAfter, 'Stop: fewer than 12 GiB remain. Nothing was deleted.');
  console.log('Image preparation verified. No native Ollama, container, DNS, or website changes.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--metadata-only') {
      console.log(JSON.stringify(inspectRegistryImage(), null, 2));
    } else if (process.argv[2] === '--prepare') {
      await prepare();
    } else {
      console.log('Use --metadata-only to inspect the registry, or --prepare on the approved Mac.');
      process.exitCode = 1;
    }
  } catch (error) {
    // Do not print captured Docker stderr or credential-related client diagnostics.
    const message = error?.code === 'ERR_ASSERTION' ? error.message : 'Preparation did not finish';
    console.error(`STOP: ${message}`);
    console.error('No containers were started. Do not prune, reset Docker, or change native Ollama.');
    process.exitCode = 1;
  }
}
