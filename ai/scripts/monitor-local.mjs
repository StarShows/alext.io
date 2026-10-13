import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
// Operator-only script. Never imported by the gateway or exposed as an HTTP route.
const alerts = [];
let containers = [];
try {
  const output = execFileSync('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project=alext-ai', '--format', '{{json .}}'], { encoding: 'utf8', timeout: 10000 });
  containers = output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).map((item) => ({ service: item.Names, state: item.State, status: item.Status }));
  for (const item of containers) if (item.state !== 'running' || /unhealthy|restarting/i.test(item.status)) alerts.push('A project container is not healthy');
  if (!containers.some((item) => /gateway/.test(item.service))) alerts.push('Gateway container is missing');
  if (!containers.some((item) => /tunnel/.test(item.service))) alerts.push('Tunnel container is missing');
} catch { alerts.push('Docker status is unavailable'); }
let hostMemoryPressure = null;
if (process.platform === 'darwin') { try { hostMemoryPressure = execFileSync('memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 5000 }).trim(); } catch { alerts.push('Host memory pressure could not be read'); } }
const disk = statfsSync(process.cwd()); const freeBytes = Number(disk.bavail) * Number(disk.bsize); const totalBytes = Number(disk.blocks) * Number(disk.bsize);
if (freeBytes < 10 * 1024 ** 3 || freeBytes / totalBytes < 0.1) alerts.push('Disk capacity is below the configured safety threshold');
let gateway = null;
try {
  gateway = JSON.parse(execFileSync('docker', ['compose', '--project-name', 'alext-ai', 'exec', '-T', 'gateway', 'node', '-e', "fetch('http://127.0.0.1:19091/metrics',{signal:AbortSignal.timeout(3000)}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))"], { encoding: 'utf8', timeout: 5000 }));
  if (!gateway.ready) alerts.push('Pinned model is unavailable');
} catch { alerts.push('Private gateway diagnostics are unavailable'); }
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), containers, disk: { freeBytes, totalBytes }, hostMemoryPressure, gateway, alerts, note: 'This local check does not prove edge connectivity, restart survival, or model quality.' }, null, 2));
if (alerts.length) process.exitCode = 1;
