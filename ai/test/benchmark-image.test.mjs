import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compressedSize,
  inspectRegistryImage,
  selectArm64,
  verifyLocalEndpoint,
} from '../scripts/prepare-benchmark-image.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const layer = { digest, size: 1024 };
const platform = { os: 'linux', architecture: 'arm64', variant: 'v8' };
const entry = { platform, digest };
const index = { manifests: [entry] };
const manifest = { schemaVersion: 2, config: layer, layers: [layer] };

test('benchmark preparation selects only an unambiguous Linux ARM64 image', () => {
  assert.equal(selectArm64(index), digest);
  assert.throws(() => selectArm64({ manifests: [] }));
  assert.throws(() => selectArm64({ manifests: [entry, entry] }));
  const amd = { platform: { os: 'linux', architecture: 'amd64' }, digest };
  assert.throws(() => selectArm64({ manifests: [amd] }));
});

test('benchmark image metadata rejects malformed digests and excessive download sizes', () => {
  const bad = { platform, digest: 'latest' };
  assert.throws(() => selectArm64({ manifests: [bad] }));
  assert.equal(compressedSize(manifest), 2048);
  const large = { schemaVersion: 2, config: layer, layers: [{ digest, size: 4 * 1024 ** 3 }] };
  assert.throws(() => compressedSize(large));
  assert.throws(() => compressedSize({ ...manifest, layers: [{ digest, size: -1 }] }));
});

test('registry preflight only reads metadata and then resolves by digest', () => {
  const calls = [];
  function command(args) {
    calls.push(args);
    return JSON.stringify(calls.length === 1 ? index : manifest);
  }
  const result = inspectRegistryImage(command);
  assert.equal(result.reference, `ollama/ollama@${digest}`);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].at(-1), 'ollama/ollama:0.40.4');
  assert.equal(calls[1].at(-1), result.reference);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 4), ['buildx', 'imagetools', 'inspect', '--raw']);
  }
});

test('preparation refuses remote Docker endpoints', () => {
  verifyLocalEndpoint('unix:///example/docker.sock');
  assert.throws(() => verifyLocalEndpoint('tcp://192.0.2.1:2375'));
  assert.throws(() => verifyLocalEndpoint('ssh://example'));
  assert.throws(() => verifyLocalEndpoint(undefined));
});
