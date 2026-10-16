import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { statfsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Operator-only preparation. Never calls a generation API or the native Mac service.
export const image =
  'ollama/ollama@sha256:9413eb2a9419819146397b9393c7a645d44753317c1b0e3a76ab45671adc2d7c';
export const model = 'qwen3.5:2b-q4_K_M';
const approvedModelManifest = '1e2d21a4f03ab9e4a9c1976a4b7e88f21de61d65f2c5485d8fde8942be73f1e7';
export const volume = 'alext-ai-benchmark-qwen35-2b';
const ownerLabel = 'io.alext.benchmark';
const ownerValue = 'qwen35-2b-v1';
const GiB = 1024 ** 3;
const manifestPath = '/models/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M';
const registryUrl = 'https://registry.ollama.ai/v2/library/qwen3.5/manifests/2b-q4_K_M';
const limits = { memoryBytes: 4 * GiB, cpuEquivalents: 4, pids: 128 };

export function validateManifest(manifest) {
  assert.equal(manifest.schemaVersion, 2, 'Unexpected model manifest version');
  assert(Array.isArray(manifest.layers), 'Missing model layers');
  assert(manifest.layers.length > 0 && manifest.layers.length <= 16, 'Invalid layer count');
  assert(
    manifest.layers.some((part) => part.mediaType === 'application/vnd.ollama.image.model'),
    'Missing local model weights',
  );
  const parts = [manifest.config, ...manifest.layers];
  let bytes = 0;
  for (const part of parts) {
    assert(part && /^sha256:[a-f0-9]{64}$/.test(part.digest), 'Invalid layer digest');
    assert(Number.isSafeInteger(part.size) && part.size > 0, 'Invalid layer size');
    bytes += part.size;
  }
  assert(Number.isSafeInteger(bytes) && bytes <= 3 * GiB, 'Model exceeds the 3 GiB download guard');
  return { parts, bytes };
}

export async function registryManifest(request = fetch) {
  const response = await request(registryUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok && response.body, 'Official model metadata is unavailable');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert(length <= 1024 * 1024, 'Model manifest is too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const manifest = JSON.parse(raw.toString('utf8'));
  const { parts, bytes } = validateManifest(manifest);
  return { manifest, parts, bytes, registryDigest: createHash('sha256').update(raw).digest('hex') };
}

export function containerArgs(name, network, { root = false, readOnlyModels = false } = {}) {
  assert(/^alext-bench-[a-f0-9-]+$/.test(name), 'Invalid temporary container name');
  assert(
    network === 'none' || /^alext-bench-[a-f0-9-]+$/.test(network),
    'Invalid benchmark network',
  );
  assert(!root || network === 'none', 'Volume initializer must have no network');
  return [
    'create',
    '--name',
    name,
    '--label',
    `${ownerLabel}=${ownerValue}`,
    '--pull=never',
    '--platform=linux/arm64',
    '--network',
    network,
    '--user',
    root ? '0:0' : '10001:10001',
    '--read-only',
    '--cap-drop=ALL',
    ...(root ? ['--cap-add=CHOWN'] : []),
    '--security-opt=no-new-privileges:true',
    '--memory=4g',
    '--memory-swap=4g',
    '--cpus=4',
    '--pids-limit=128',
    '--restart=no',
    '--log-driver=local',
    '--log-opt=max-size=1m',
    '--log-opt=max-file=1',
    '--log-opt=compress=false',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
    '--mount',
    `type=volume,src=${volume},dst=/models,volume-nocopy${readOnlyModels ? ',readonly' : ''}`,
    '--env=HOME=/tmp/ollama-home',
    '--env=OLLAMA_MODELS=/models',
    '--env=OLLAMA_HOST=127.0.0.1:11434',
    '--env=OLLAMA_NO_CLOUD=1',
    '--env=OLLAMA_CONTEXT_LENGTH=4096',
    '--env=OLLAMA_NUM_PARALLEL=1',
    '--env=OLLAMA_MAX_LOADED_MODELS=1',
    '--env=OLLAMA_MAX_QUEUE=2',
    '--env=OLLAMA_DEBUG=false',
    '--env=OLLAMA_KEEP_ALIVE=0',
    ...[
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'no_proxy',
    ].map((key) => `--env=${key}=`),
    '--entrypoint=/bin/sh',
    image,
    '-ec',
    root ? 'chown 10001:10001 /models' : 'umask 077; exec /bin/ollama serve >/tmp/server.log 2>&1',
  ];
}

export function verifyContainer(actual, network, { root = false, readOnlyModels = false } = {}) {
  const host = actual.HostConfig;
  assert.equal(actual.Config.Labels[ownerLabel], ownerValue, 'Container ownership mismatch');
  assert.equal(actual.Config.Image, image, 'Container image mismatch');
  assert.equal(actual.Config.User, root ? '0:0' : '10001:10001', 'Container user mismatch');
  assert.equal(host.NetworkMode, network, 'Container network mismatch');
  assert.equal(host.Privileged, false, 'Privileged container refused');
  assert.equal(host.ReadonlyRootfs, true, 'Writable root filesystem refused');
  assert.equal(host.Memory, limits.memoryBytes, 'Memory limit not applied');
  assert.equal(host.MemorySwap, limits.memoryBytes, 'Container swap limit not applied');
  assert.equal(host.NanoCpus, 4000000000, 'CPU limit not applied');
  assert.equal(host.PidsLimit, limits.pids, 'Process limit not applied');
  assert.equal(host.RestartPolicy.Name, 'no', 'Automatic restart refused');
  assert.equal(host.LogConfig.Type, 'local', 'Unexpected logging driver');
  assert.equal(host.LogConfig.Config['max-size'], '1m', 'Log size not bounded');
  assert.equal(host.LogConfig.Config['max-file'], '1', 'Log count not bounded');
  assert.equal(host.LogConfig.Config.compress, 'false', 'Single-file logging must not compress');
  assert.deepEqual(host.CapDrop, ['ALL'], 'Capabilities not dropped');
  const addedCaps = (host.CapAdd ?? []).map((name) => name.replace(/^CAP_/, ''));
  assert.deepEqual(addedCaps, root ? ['CHOWN'] : [], 'Unexpected added capability');
  assert(
    host.SecurityOpt.some((value) => /^no-new-privileges(?::true)?$/.test(value)),
    'Missing privilege restriction',
  );
  assert.equal(Object.keys(host.PortBindings ?? {}).length, 0, 'Published ports refused');
  assert.equal(host.PublishAllPorts, false, 'Published ports refused');
  assert.equal((host.Binds ?? []).length, 0, 'Host filesystem binds refused');
  assert.equal((host.Devices ?? []).length, 0, 'Host devices refused');
  assert.equal((host.DeviceRequests ?? []).length, 0, 'GPU devices refused');
  assert.equal(actual.Mounts.length, 1, 'Unexpected filesystem mounts');
  const mount = actual.Mounts[0];
  assert.equal(mount.Type, 'volume', 'Expected a named volume');
  assert.equal(mount.Name, volume, 'Unexpected volume');
  assert.equal(mount.Destination, '/models', 'Unexpected mount location');
  assert.equal(mount.RW, !readOnlyModels, 'Incorrect model volume access');
  for (const setting of [
    'OLLAMA_HOST=127.0.0.1:11434',
    'OLLAMA_NO_CLOUD=1',
    'OLLAMA_MODELS=/models',
  ])
    assert(actual.Config.Env.includes(setting), 'Missing fixed local Ollama setting');
}

function dockerClient() {
  const invoke = (args, options = {}) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  const context = invoke(['context', 'show']);
  const [details] = JSON.parse(invoke(['context', 'inspect', context]));
  assert(
    details.Endpoints?.docker?.Host?.startsWith('unix:///'),
    'Refusing a remote Docker endpoint',
  );
  const run = (args, options) => invoke(['--context', context, ...args], options);
  assert(
    ['linux/aarch64', 'linux/arm64'].includes(
      run(['info', '--format', '{{.OSType}}/{{.Architecture}}']),
    ),
    'Expected a local ARM64 Docker VM',
  );
  const [installed] = JSON.parse(run(['image', 'inspect', image]));
  assert.equal(installed.Architecture, 'arm64', 'Installed image architecture mismatch');
  assert.equal(installed.Os, 'linux', 'Installed image OS mismatch');
  assert(installed.RepoDigests?.includes(image), 'Pinned image not installed');
  return { run, context };
}

function macFreeBytes() {
  const stats = statfsSync('/System/Volumes/Data', { bigint: true });
  return Number(stats.bavail * stats.bsize);
}

export async function prepare({ smoke = false } = {}) {
  assert.equal(process.arch, 'arm64', 'Native ARM64 Node is required');
  assert.equal(process.platform, smoke ? 'linux' : 'darwin', 'Incorrect preparation host');
  if (smoke)
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Smoke mode is restricted to isolated CI');
  const { run, context } = dockerClient();
  const metadata = smoke ? null : await registryManifest();
  if (!smoke)
    assert.equal(
      metadata.registryDigest,
      approvedModelManifest,
      'Model tag changed; review required',
    );
  const freeBefore = smoke ? null : macFreeBytes();
  if (!smoke)
    assert(
      freeBefore >= 12 * GiB + 2 * metadata.bytes + GiB,
      'Insufficient Mac disk reserve for model download',
    );
  const known = run(['volume', 'ls', '--format', '{{.Name}}']).split('\n');
  if (!known.includes(volume))
    run(['volume', 'create', '--driver=local', '--label', `${ownerLabel}=${ownerValue}`, volume]);
  const [storage] = JSON.parse(run(['volume', 'inspect', volume]));
  assert.equal(storage.Labels?.[ownerLabel], ownerValue, 'Refusing an unrelated existing volume');
  assert.equal(storage.Driver, 'local', 'Unexpected volume driver');
  assert.equal(Object.keys(storage.Options ?? {}).length, 0, 'Custom volume mounts refused');
  assert.equal(
    run(['ps', '-aq', '--filter', `volume=${volume}`]),
    '',
    'Benchmark volume is already attached to a container',
  );
  const owned = new Set();
  let outbound;
  let interrupt = false;
  let pullProcess;
  const onSignal = () => {
    interrupt = true;
    pullProcess?.kill('SIGTERM');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const temporary = async (network, options, action) => {
    assert(!interrupt, 'Preparation interrupted');
    const name = `alext-bench-${randomUUID()}`;
    const id = run(containerArgs(name, network, options));
    assert(/^[a-f0-9]{64}$/.test(id), 'Invalid created container ID');
    owned.add(id);
    try {
      verifyContainer(JSON.parse(run(['inspect', id]))[0], network, options);
      run(['start', id]);
      return await action(id);
    } finally {
      run(['rm', '--force', id]);
      owned.delete(id);
    }
  };
  const ready = async (id) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      assert(!interrupt, 'Preparation interrupted');
      try {
        run(['exec', id, '/bin/ollama', 'list']);
        return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Ollama readiness timed out');
  };
  const noLoadedModels = (id) => {
    const lines = run(['exec', id, '/bin/ollama', 'ps'])
      .split('\n')
      .filter((line) => line.trim());
    assert(
      lines.length === 1 && /^NAME\s/.test(lines[0]),
      'Unexpected loaded model; no inference was requested',
    );
  };
  let result;
  try {
    await temporary('none', { root: true }, (id) => {
      assert.equal(run(['wait', id]), '0', 'Volume initialization failed');
    });
    if (!smoke) {
      outbound = `alext-bench-${randomUUID()}`;
      run([
        'network',
        'create',
        '--driver=bridge',
        '--label',
        `${ownerLabel}=${ownerValue}`,
        outbound,
      ]);
      console.log(
        `Downloading only ${model}: ${(metadata.bytes / 1e9).toFixed(2)} GB of model data.`,
      );
      await temporary(outbound, {}, async (id) => {
        await ready(id);
        const df = run(['exec', id, '/bin/df', '-Pk', '/models'])
          .trim()
          .split('\n')
          .at(-1)
          .trim()
          .split(/\s+/);
        assert(
          Number(df[3]) * 1024 >= 2 * metadata.bytes + GiB,
          'Insufficient Docker VM disk space',
        );
        const sockets = run(['exec', id, '/bin/cat', '/proc/net/tcp', '/proc/net/tcp6']);
        const listeners = sockets
          .split('\n')
          .map((row) => row.trim().split(/\s+/))
          .filter((row) => row[3] === '0A' && row[1]?.endsWith(':2CAA'));
        assert(
          listeners.length === 1 && listeners[0][1] === '0100007F:2CAA',
          'Loader API is not exclusively on container loopback',
        );
        noLoadedModels(id);
        let diskWatch;
        try {
          await new Promise((resolve, reject) => {
            pullProcess = spawn(
              'docker',
              ['--context', context, 'exec', id, '/bin/ollama', 'pull', model],
              { stdio: ['ignore', 'inherit', 'inherit'], timeout: 30 * 60 * 1000 },
            );
            diskWatch = setInterval(() => {
              try {
                if (macFreeBytes() < 12 * GiB) pullProcess.kill('SIGTERM');
              } catch {
                pullProcess.kill('SIGTERM');
              }
            }, 3000);
            pullProcess.once('error', reject);
            pullProcess.once('exit', (code) =>
              code === 0 ? resolve() : reject(new Error('Model download interrupted or failed')),
            );
          });
        } finally {
          clearInterval(diskWatch);
          pullProcess = null;
        }
        noLoadedModels(id);
      });
      run(['network', 'rm', outbound]);
      outbound = null;
    }
    result = await temporary('none', { readOnlyModels: true }, async (id) => {
      await ready(id);
      noLoadedModels(id);
      if (smoke)
        return {
          status: 'arm64-container-smoke-passed',
          inferenceRun: false,
          modelDownloaded: false,
        };
      const localRaw = run(['exec', id, '/bin/cat', manifestPath]);
      const localManifest = JSON.parse(localRaw);
      assert.deepEqual(
        localManifest,
        metadata.manifest,
        'Registry tag changed during download; model must be reviewed',
      );
      const digest = run(['exec', id, '/usr/bin/sha256sum', manifestPath]).split(/\s+/)[0];
      assert(/^[a-f0-9]{64}$/.test(digest), 'Invalid stored model digest');
      console.log('Download finished. Verifying stored model files without network access.');
      for (const part of metadata.parts) {
        const path = `/models/blobs/${part.digest.replace(':', '-')}`;
        assert.equal(
          Number(run(['exec', id, '/usr/bin/stat', '-c', '%s', path])),
          part.size,
          'Stored model file size mismatch',
        );
        const actual = run(['exec', id, '/usr/bin/sha256sum', path], { timeout: 180000 }).split(
          /\s+/,
        )[0];
        assert.equal(actual, part.digest.slice(7), 'Stored model checksum mismatch');
      }
      const configPath = `/models/blobs/${localManifest.config.digest.replace(':', '-')}`;
      const config = JSON.parse(run(['exec', id, '/bin/cat', configPath]));
      assert(
        !config.remote_host && !config.remote_model && config.model_format === 'gguf',
        'Remote or non-GGUF model refused',
      );
      noLoadedModels(id);
      return {
        status: 'model-prepared',
        image,
        model,
        volume,
        modelDigest: digest,
        registryManifestDigest: metadata.registryDigest,
        modelBytes: metadata.bytes,
        limits,
        downloadedFilesVerified: metadata.parts.length,
        readOnlyOfflineStartupVerified: true,
        noModelsLoaded: true,
        inferenceRun: false,
        nativeOllamaChanged: false,
        publicPortsPublished: false,
        macFreeBeforeBytes: freeBefore,
      };
    });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    for (const id of owned) {
      try {
        run(['rm', '--force', id]);
      } catch {
        console.error('STOP: A temporary benchmark container needs cleanup.');
      }
    }
    if (outbound) {
      try {
        run(['network', 'rm', outbound]);
      } catch {
        console.error('STOP: A temporary benchmark network needs cleanup.');
      }
    }
  }
  assert(!interrupt, 'Preparation interrupted');
  assert.equal(
    run(['ps', '-aq', '--filter', `volume=${volume}`]),
    '',
    'A benchmark container remains; stop before proceeding',
  );
  result.temporaryContainersRemoved = true;
  result.recordedAt = new Date().toISOString();
  if (!smoke) {
    result.macFreeAfterBytes = macFreeBytes();
    if (result.macFreeAfterBytes < 12 * GiB) result.status = 'stop-low-disk';
    const stamp = result.recordedAt.replace(/[:.]/g, '-');
    const report = join(homedir(), 'Downloads', `alext-benchmark-model-${stamp}.json`);
    writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  console.log('\n== Model preparation summary ==');
  console.log(JSON.stringify(result, null, 2));
  assert(result.status !== 'stop-low-disk', 'Stop: fewer than 12 GiB remain');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--prepare') await prepare();
    else if (process.argv[2] === '--smoke') await prepare({ smoke: true });
    else if (process.argv[2] === '--metadata-only')
      console.log(JSON.stringify(await registryManifest(), null, 2));
    else throw new Error('Use --prepare on the approved Mac mini');
  } catch (error) {
    console.error(
      `STOP: ${error?.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Model preparation did not finish'}`,
    );
    console.error(
      'Existing applications and native Ollama were not changed. Model volume retained; do not prune or reset Docker.',
    );
    process.exitCode = 1;
  }
}
