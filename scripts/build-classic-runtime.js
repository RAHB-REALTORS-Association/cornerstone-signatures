import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../outlook-addin/src/classic-runtime-entry.js', import.meta.url);
const outputPath = new URL('../outlook-addin/dist/classic-runtime-entry.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');

const unsupportedSyntax = [
  ['arrow function', /=>/],
  ['async function', /\basync\s+(?:function|\()/],
  ['await expression', /\bawait\b/],
  ['optional chaining', /\?\./],
  ['nullish coalescing', /\?\?/],
  ['template literal', /`/],
  ['module import', /^\s*import\s/m],
];

for (const [name, pattern] of unsupportedSyntax) {
  if (pattern.test(source)) throw new Error(`Classic Outlook runtime contains unsupported ${name} syntax.`);
}

await writeFile(outputPath, source);
console.log('Built Outlook classic runtime.');
