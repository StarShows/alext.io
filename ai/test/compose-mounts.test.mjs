import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { smokeComposeMounts, verifyComposeMounts } from '../scripts/compose-mounts.mjs';

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

// Execute the exact generated probe against fixture mountinfo, without invoking Docker.
function probeWithFlags(flagsForMount) {
  return (command, args) => {
    assert.equal(command, 'docker');
    assert(args.includes('--network=none'));
    assert(args.includes('--cap-drop=ALL'));
    const mount = args[args.indexOf('--tmpfs') + 1];
    const flags = flagsForMount(mount);
    const fakeFs = {
      writeFileSync() {},
      unlinkSync() {},
      statfsSync: () => ({ type: 0x1021994 }),
      readFileSync: () => `1 0 0:1 / /tmp ${flags} - tmpfs tmpfs rw`,
    };
    runInNewContext(args.at(-1), {
      process: { getuid: () => 10001 },
      require: (name) => {
        if (name === 'node:fs') return fakeFs;
        assert.equal(name, 'node:assert/strict');
        return assert;
      },
    });
  };
}

test('runtime mount probes accept extra noexec restrictions on every service', () => {
  smokeComposeMounts(
    fixture(),
    probeWithFlags(() => 'rw,nosuid,nodev,noexec'),
  );
});

test('runtime mount probes permit execution only where noexec was not required', () => {
  const flagsForMount = (mount) => {
    return mount.includes('noexec') ? 'rw,nosuid,nodev,noexec' : 'rw,nosuid,nodev';
  };
  smokeComposeMounts(fixture(), probeWithFlags(flagsForMount));
});

test('runtime mount probes still reject missing required security flags', () => {
  for (const flags of ['rw,nosuid,nodev', 'rw,nodev,noexec', 'rw,nosuid,noexec']) {
    const probe = () =>
      smokeComposeMounts(
        fixture(),
        probeWithFlags(() => flags),
      );
    assert.throws(probe, { code: 'ERR_ASSERTION' });
  }
});
