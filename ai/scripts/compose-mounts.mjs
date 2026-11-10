import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const expectedMounts = {
  gateway: '/tmp:size=16m,noexec,nosuid,nodev,mode=1777',
  ollama: '/tmp:size=256m,nosuid,nodev,mode=1777',
  tunnel: '/tmp:size=8m,noexec,nosuid,nodev,mode=1777',
  'model-loader': '/tmp:size=256m,nosuid,nodev,mode=1777',
};

export function verifyComposeMounts(config) {
  for (const [name, mount] of Object.entries(expectedMounts)) {
    assert.deepEqual(config.services[name]?.tmpfs, [mount], `${name}: invalid tmpfs mount`);
  }
}

export function smokeComposeMounts(config, run = execFileSync) {
  verifyComposeMounts(config);
  const image = 'alext-ai-ci:smoke';
  for (const [name, mount] of Object.entries(expectedMounts)) {
    // Omission of noexec does not request exec. Accept stricter runtime defaults.
    // This checks mount protections, not whether real Ollama can load its runners.
    const script = [
      "const fs = require('node:fs'), a = require('node:assert/strict');",
      'a.equal(process.getuid(), 10001);',
      "fs.writeFileSync('/tmp/mount-check', 'ok');",
      "a.equal(fs.statfsSync('/tmp').type, 0x01021994);",
      "const row = fs.readFileSync('/proc/self/mountinfo', 'utf8')",
      ".split(String.fromCharCode(10)).find(line => line.split(' ')[4] === '/tmp');",
      "const flags = row.split(' ')[5].split(',');",
      "a(flags.includes('nosuid')); a(flags.includes('nodev'));",
      `if (${mount.includes('noexec')}) a(flags.includes('noexec'));`,
      "fs.unlinkSync('/tmp/mount-check');",
    ].join('\n');
    run(
      'docker',
      [
        'run',
        '--rm',
        '--pull=never',
        '--network=none',
        '--user=10001:10001',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--pids-limit=64',
        '--memory=128m',
        '--cpus=0.5',
        '--tmpfs',
        mount,
        '--entrypoint=node',
        image,
        '-e',
        script,
      ],
      { stdio: 'inherit', timeout: 30000 },
    );
    console.log(`${name}: parsed tmpfs options verified in an isolated smoke container`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  smokeComposeMounts(config);
}
