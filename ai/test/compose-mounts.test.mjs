import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyComposeMounts } from '../scripts/compose-mounts.mjs';

function fixture() {
  return {
    services: {
      gateway: { tmpfs: ['/tmp:size=16m,noexec,nosuid,nodev,mode=1777'] },
      ollama: { tmpfs: ['/tmp:size=256m,nosuid,nodev,mode=1777'] },
      tunnel: { tmpfs: ['/tmp:size=8m,noexec,nosuid,nodev,mode=1777'] },
      'model-loader': { tmpfs: ['/tmp:size=256m,nosuid,nodev,mode=1777'] },
    },
  };
}

test('Compose mount validation accepts one absolute tmpfs entry per service', () => {
  assert.doesNotThrow(() => verifyComposeMounts(fixture()));
});

test('Compose mount validation rejects the original comma-separated YAML flow-list bug', () => {
  for (const name of Object.keys(fixture().services)) {
    const config = fixture();
    config.services[name].tmpfs = config.services[name].tmpfs[0].split(',');
    assert.throws(() => verifyComposeMounts(config), /invalid tmpfs mount/);
  }
});

test('Compose mount validation rejects missing mounts and weakened protections', () => {
  for (const change of [
    (c) => delete c.services['model-loader'],
    (c) => (c.services.gateway.tmpfs = ['/tmp']),
    (c) => (c.services.gateway.tmpfs = ['/tmp:size=16m,nosuid,nodev,mode=1777']),
    (c) => (c.services.ollama.tmpfs = ['/tmp:size=256m,nosuid,mode=1777']),
  ]) {
    const config = fixture();
    change(config);
    assert.throws(() => verifyComposeMounts(config), /invalid tmpfs mount/);
  }
});
