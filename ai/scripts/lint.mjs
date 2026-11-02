import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const files = await readdir(new URL('../src/', import.meta.url));
for (const name of files.filter((name) => name.endsWith('.ts'))) {
  const text = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  assert(
    !/\beval\s*\(|new Function\s*\(|node:child_process|node:vm|\.innerHTML\s*=/.test(text),
    `Unsafe runtime primitive: ${name}`,
  );
  assert(
    !/https:\/\/(?:api\.openai|api\.anthropic|generativelanguage\.googleapis)/.test(text),
    `External inference: ${name}`,
  );
  assert(!/console\.(?:log|debug)\(/.test(text), `Unstructured logging: ${name}`);
}
console.log('Runtime security lint passed. TypeScript strict compilation is checked separately.');
