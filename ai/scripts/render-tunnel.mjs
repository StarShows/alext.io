import { readFile, mkdir, writeFile } from 'node:fs/promises';
const id = process.env.TUNNEL_ID ?? '';
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Set the approved tunnel UUID locally. Never paste its credentials into chat.');
const template = await readFile(new URL('../ops/cloudflared.yml.example', import.meta.url), 'utf8');
await mkdir(new URL('../ops/generated/', import.meta.url), { recursive: true, mode: 0o700 });
await writeFile(new URL('../ops/generated/cloudflared.yml', import.meta.url), template.replace('REPLACE_TUNNEL_UUID', id), { mode: 0o644 });
console.log('Local tunnel configuration created. No DNS, account or network setting was changed.');
