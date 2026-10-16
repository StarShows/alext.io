import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { containerArgs, image, registryManifest, validateManifest, verifyContainer, volume } from '../scripts/prepare-benchmark-model.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
function manifest() {
  return { schemaVersion: 2, config: { digest, size: 100 }, layers: [{ digest, size: 200, mediaType: 'application/vnd.ollama.image.model' }] };
}
function inspection(root = false, readOnlyModels = false) {
  return {
    Config: {
      Image: image, User: root ? '0:0' : '10001:10001', Labels: { 'io.alext.benchmark': 'qwen35-2b-v1' },
      Env: ['OLLAMA_HOST=127.0.0.1:11434', 'OLLAMA_MODELS=/models', 'OLLAMA_NO_CLOUD=1'],
    },
    HostConfig: {
      NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true,
      Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, NanoCpus: 4000000000,
      PidsLimit: 128, RestartPolicy: { Name: 'no' }, CapDrop: ['ALL'],
      CapAdd: root ? ['CHOWN'] : null, SecurityOpt: ['no-new-privileges'],
      PortBindings: {}, PublishAllPorts: false, Binds: null, Devices: [], DeviceRequests: [],
    },
    Mounts: [{ Type: 'volume', Name: volume, Destination: '/models', RW: !readOnlyModels }],
  };
}

test('model metadata requires local weights, bounded layers, sizes and valid content digests', () => {
  assert.equal(validateManifest(manifest()).bytes, 300);
  for (const change of [
    (m) => (m.schemaVersion = 1),
    (m) => (m.layers = []),
    (m) => (m.layers[0].mediaType = 'remote'),
    (m) => (m.layers[0].digest = 'sha256:../../secrets'),
    (m) => (m.config = null),
    (m) => (m.layers[0].size = -1),
    (m) => (m.layers[0].size = 4 * 1024 ** 3),
    (m) => (m.layers = Array(17).fill(m.layers[0])),
  ]) {
    const value = manifest(); change(value);
    assert.throws(() => validateManifest(value));
  }
});

test('registry metadata uses only the fixed official HTTPS URL with redirects disabled', async () => {
  const result = await registryManifest(async (url, options) => {
    assert.equal(url, 'https://registry.ollama.ai/v2/library/qwen3.5/manifests/2b-q4_K_M');
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(manifest()));
  });
  assert.equal(result.bytes, 300);
  assert.match(result.registryDigest, /^[a-f0-9]{64}$/);
});

test('registry metadata rejects error responses, corrupt JSON and oversized bodies', async () => {
  for (const response of [new Response('', { status: 403 }), new Response('{'), new Response('x'.repeat(1024 * 1024 + 1))])
    await assert.rejects(() => registryManifest(async () => response));
});

test('all stage containers have fixed resource ceilings, no published ports or host binds', () => {
  for (const options of [{}, { root: true }, { readOnlyModels: true }]) {
    const args = containerArgs('alext-bench-abcdef', 'none', options);
    for (const flag of ['--pull=never', '--platform=linux/arm64', '--read-only', '--cap-drop=ALL', '--memory=4g', '--memory-swap=4g', '--cpus=4', '--restart=no']) assert(args.includes(flag));
    assert(!args.some((a) => /^(-p|-P|--publish|--privileged|--pid=host|--network=host)$/.test(a)));
    assert(args.includes(image));
    assert(args.includes('--env=OLLAMA_HOST=127.0.0.1:11434'));
    assert(args.includes('--env=OLLAMA_NO_CLOUD=1'));
    assert(!args.some((a) => a.includes('/Users/') || a.includes('docker.sock')));
    assert(args[args.indexOf('--mount') + 1].endsWith(options.readOnlyModels ? ',readonly' : 'volume-nocopy'));
  }
  assert.throws(() => containerArgs('alext-bench-abcdef', 'host'));
  assert.throws(() => containerArgs('other-app', 'none'));
  assert.throws(() => containerArgs('alext-bench-abcdef', 'alext-bench-abcdef', { root: true }));
});

test('created-container checks accept only the intended initializer and server configurations', () => {
  for (const options of [{}, { root: true }, { readOnlyModels: true }])
    assert.doesNotThrow(() => verifyContainer(inspection(options.root, options.readOnlyModels), 'none', options));
});

test('created-container checks fail closed on weakened isolation or resource controls', () => {
  for (const change of [
    (c) => (c.HostConfig.Memory = 0), (c) => (c.HostConfig.MemorySwap = -1),
    (c) => (c.HostConfig.NanoCpus = 0), (c) => (c.HostConfig.Privileged = true),
    (c) => (c.HostConfig.ReadonlyRootfs = false), (c) => (c.HostConfig.NetworkMode = 'host'),
    (c) => (c.HostConfig.PortBindings = { '11434/tcp': [{}] }),
    (c) => (c.HostConfig.Binds = ['/Users:/Users']),
    (c) => (c.HostConfig.CapAdd = ['SYS_ADMIN']), (c) => (c.HostConfig.SecurityOpt = []),
    (c) => (c.Config.User = '0:0'), (c) => (c.Config.Image = 'ollama/ollama:latest'),
    (c) => (c.Config.Labels = {}), (c) => (c.Config.Env = []),
    (c) => (c.Mounts[0].Name = 'other-project'),
    (c) => c.Mounts.push({ Type: 'bind', Destination: '/host' }),
  ]) {
    const value = inspection(); change(value);
    assert.throws(() => verifyContainer(value, 'none'));
  }
});

test('preparation never requests generation, host networking, a public bind or a global prune', () => {
  const source = readFileSync(new URL('../scripts/prepare-benchmark-model.mjs', import.meta.url), 'utf8');
  assert(!/\/api\/(?:chat|generate)|host\.docker\.internal|OLLAMA_HOST=0\.0\.0\.0/.test(source));
  assert(!/['"](?:system|volume)['"],\s*['"]prune['"]/.test(source));
  assert(source.includes('readOnlyModels: true'));
  assert(source.includes("temporary('none'"));
  assert(source.includes("'network', 'rm', outbound"));
});

test('default CLI invocation fails rather than creating infrastructure', () => {
  const path = new URL('../scripts/prepare-benchmark-model.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [path], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STOP:/);
});
