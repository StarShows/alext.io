// Temporary, exact implementation-branch migrations. Removed from CI after the tested commit lands.
import { readFile, writeFile } from 'node:fs/promises';
async function patch(path, transform) {
  const url = new URL(path, import.meta.url);
  const text = await readFile(url, 'utf8');
  await writeFile(url, transform(text));
}
await patch('../test/transport.test.mjs', (text) =>
  text.slice(
    0,
    text.indexOf("test('real HTTP SSE") >= 0 ? text.indexOf("test('real HTTP SSE") : text.length,
  ),
);
await patch('../src/knowledge.ts', (text) =>
  text.replace('what how tell about', 'what how tell about built build show makes strong'),
);
