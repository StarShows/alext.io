// One-time migration for the implementation branch. Removed from CI after its tested commit lands.
import { readFile, writeFile } from 'node:fs/promises';
const url = new URL('../test/transport.test.mjs', import.meta.url);
const original = await readFile(url, 'utf8');
const updated = original.replace("  const state = service.sessions.get(token, service.sessions.get ? [...[]].join('') : '', config.origin);\n  void state;\n", '');
await writeFile(url, updated);
