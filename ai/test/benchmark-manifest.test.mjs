import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  approvedModelManifest,
  verifyLocalManifest,
  verifyStoredModel,
} from '../scripts/prepare-benchmark-model.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

// Public registry metadata captured for the approved model, not visitor or owner data.
const capturedOriginalRaw =
  '{"schemaVersion":2,"mediaType":"application/vnd.docker.distribution.manifest.v2+json","config":{"mediaType":"application/vnd.docker.container.image.v1+json","digest":"sha256:37f57288e2ab61515e0db050eb9eee2d4b25881e49d95e7d20b2809b245d6220","size":177},"layers":[{"mediaType":"application/vnd.ollama.image.projector","digest":"sha256:5ddf560e34046fd958b2576324f2a9b57d70f297afe6526958d60a23f3bfc20b","size":671372768,"from":"mmproj.gguf"},{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:20cb277f0967ace47b0b5d5658e5e494a88937f7378b74b5a266496400938f4c","size":1274396992,"from":"model.gguf"},{"mediaType":"application/vnd.ollama.image.template","digest":"sha256:b507b9c2f6ca642bffcd06665ea7c91f235fd32daeefdf875a0f938db05fb315","size":13},{"mediaType":"application/vnd.ollama.image.license","digest":"sha256:50cbab8a892c5f2993b8c7351a99182507472def3b1374558308605d99b86b32","size":11343},{"mediaType":"application/vnd.ollama.image.params","digest":"sha256:9371364b27a52acac9d87f88bd93c9db1174d8d6ec57f6888925cdc1788871ff","size":65}],"runner":"llamacpp","format":"gguf"}';
const capturedOriginal = JSON.parse(capturedOriginalRaw);
const capturedCompatibility = structuredClone(capturedOriginal);
capturedCompatibility.layers.push({
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  digest: `sha256:${approvedModelManifest}`,
  size: Buffer.byteLength(capturedOriginalRaw),
});
const metadata = {
  manifest: capturedOriginal,
  registryDigest: approvedModelManifest,
  manifestBytes: Buffer.byteLength(capturedOriginalRaw),
};

test('captured registry and compatibility metadata reproduce the independently observed hashes', () => {
  const hash = (raw) => createHash('sha256').update(raw).digest('hex');
  assert.equal(hash(capturedOriginalRaw), approvedModelManifest);
  assert.equal(metadata.manifestBytes, 1088);
  assert.equal(
    hash(JSON.stringify(capturedCompatibility)),
    '2fcba4e039b23928e05c8554adc262dbf5652d70bb20a36c947db9272c38c1dc',
  );
});

test('verification accepts only the exact approved manifest or its exact downgrade anchor', () => {
  assert.equal(verifyLocalManifest(capturedOriginal, metadata), false);
  assert.equal(verifyLocalManifest(capturedCompatibility, metadata), true);
  assert.deepEqual(capturedOriginal, JSON.parse(capturedOriginalRaw));
  assert.equal(capturedCompatibility.layers.length, 6);
});

test('anchor handling rejects changes to config, layers, ordering, format and unknown fields', () => {
  for (const change of [
    (m) => (m.config.digest = digest),
    (m) => (m.config.size += 1),
    (m) => (m.layers[0].digest = digest),
    (m) => (m.layers[0].from = 'other.gguf'),
    (m) => (m.layers[1].size += 1),
    (m) => (m.layers[2].mediaType = 'application/vnd.ollama.image.system'),
    (m) => m.layers.reverse(),
    (m) => m.layers.splice(2, 1),
    (m) => (m.runner = 'mlx'),
    (m) => (m.format = 'safetensors'),
    (m) => (m.remote_host = 'https://unexpected.invalid'),
    (m) => (m.unexpected = true),
  ]) {
    const value = structuredClone(capturedCompatibility);
    change(value);
    assert.throws(() => verifyLocalManifest(value, metadata));
  }
});

test('anchor handling rejects extra references, changed sizes, digests or provenance properties', () => {
  for (const change of [
    (m) => m.layers.push(m.layers.at(-1)),
    (m) => (m.layers.at(-1).digest = digest),
    (m) => (m.layers.at(-1).size += 1),
    (m) => (m.layers.at(-1).mediaType = 'application/vnd.ollama.image.model'),
    (m) => (m.layers.at(-1).from = 'unexpected'),
  ]) {
    const value = structuredClone(capturedCompatibility);
    change(value);
    assert.throws(() => verifyLocalManifest(value, metadata));
  }
  assert.throws(() =>
    verifyLocalManifest(capturedCompatibility, { ...metadata, registryDigest: 'a'.repeat(64) }),
  );
  assert.throws(() =>
    verifyLocalManifest(capturedCompatibility, { ...metadata, manifestBytes: 0 }),
  );
});

// Docker responses are fixtures here. Actual downloaded files must still be hashed
// on the owner's machine; these tests exercise enforcement, not real model integrity.
function storedModelFixture(override = () => undefined) {
  const seen = [];
  const originalPath = `/models/blobs/sha256-${approvedModelManifest}`;
  const activePath = '/models/manifests-v2/ollama.com/library/qwen3.5/2b-q4_K_M';
  const legacyPath = '/models/manifests/registry.ollama.ai/library/qwen3.5/2b-q4_K_M';
  const configRaw =
    '{"model_format":"gguf","model_family":"qwen35","model_families":["qwen35"],"model_type":"1.9B","file_type":"Q4_K_M","renderer":"qwen3.5","parser":"qwen3.5","requires":"0.30.0"}';
  const files = new Map([
    [originalPath, { raw: capturedOriginalRaw, size: 1088, hash: approvedModelManifest }],
    [activePath, { raw: capturedOriginalRaw, size: 1088, hash: approvedModelManifest }],
    [
      legacyPath,
      {
        raw: JSON.stringify(capturedCompatibility),
        size: Buffer.byteLength(JSON.stringify(capturedCompatibility)),
        hash: '2fcba4e039b23928e05c8554adc262dbf5652d70bb20a36c947db9272c38c1dc',
      },
    ],
  ]);
  for (const part of [capturedOriginal.config, ...capturedOriginal.layers]) {
    files.set(`/models/blobs/${part.digest.replace(':', '-')}`, {
      size: part.size,
      hash: part.digest.slice(7),
      raw: part === capturedOriginal.config ? configRaw : undefined,
    });
  }
  const run = (args) => {
    assert.equal(args[0], 'exec');
    const command = args[2];
    const path = args.at(-1);
    seen.push([command, path]);
    const replacement = override(command, path);
    if (replacement !== undefined) return replacement;
    if (command === '/usr/bin/readlink') {
      assert.equal(path, activePath);
      return originalPath;
    }
    const file = files.get(path);
    assert(file, 'Unexpected file access');
    if (command === '/usr/bin/stat') return String(file.size);
    if (command === '/usr/bin/sha256sum') return `${file.hash}  ${path}`;
    assert.equal(command, '/bin/cat');
    assert.equal(typeof file.raw, 'string');
    return file.raw;
  };
  return { run, seen, originalPath, activePath, legacyPath };
}

test('stored verification checks active v2 identity and original files without trusting legacy digest', () => {
  const fixture = storedModelFixture();
  const result = verifyStoredModel(fixture.run, 'a'.repeat(64));
  assert.equal(result.modelDigest, approvedModelManifest);
  assert.notEqual(result.modelDigest, result.compatibilityManifestDigest);
  assert.equal(result.downloadedFilesVerified, 6);
  assert.equal(result.hasCompatibilityAnchor, true);
  assert.equal(result.activeManifestVerified, true);
  for (const part of [capturedOriginal.config, ...capturedOriginal.layers]) {
    assert(
      fixture.seen.some(
        ([cmd, path]) =>
          cmd === '/usr/bin/sha256sum' && path.endsWith(part.digest.replace(':', '-')),
      ),
    );
  }
});

test('stored verification rejects missing or corrupt provenance, redirection and oversized metadata', () => {
  const base = storedModelFixture();
  for (const override of [
    (cmd, path) =>
      cmd === '/usr/bin/sha256sum' && path === base.originalPath ? 'a'.repeat(64) : undefined,
    (cmd, path) =>
      cmd === '/usr/bin/sha256sum' && path === base.activePath ? 'a'.repeat(64) : undefined,
    (cmd) => (cmd === '/usr/bin/readlink' ? '/models/blobs/sha256-other' : undefined),
    (cmd, path) => (cmd === '/usr/bin/stat' && path === base.legacyPath ? '999999' : undefined),
    (cmd, path) =>
      cmd === '/usr/bin/sha256sum' && path.endsWith(capturedOriginal.layers[0].digest.slice(7))
        ? 'a'.repeat(64)
        : undefined,
    (cmd, path) => {
      if (path === base.originalPath) throw new Error('missing original blob');
    },
  ]) {
    assert.throws(() => verifyStoredModel(storedModelFixture(override).run, 'a'.repeat(64)));
  }
});
