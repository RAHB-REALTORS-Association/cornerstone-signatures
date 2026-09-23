import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../../outlook-addin/src/runtime-entry.js', import.meta.url);
const managedSignatureUrl = new URL('../../outlook-addin/src/managed-signature.js', import.meta.url);

test('mobile From changes wait for Outlook to expose the updated sender', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /settleAfterChange:\s*clearWhenUnavailable/);
  assert.match(source, /Android\|iPhone\|iPad\|iPod/);
  assert.match(source, /\[300, 600, 1100\]/);
  assert.match(source, /nextSenderEmail !== initial/);
  assert.match(source, /report\('sender_probe'/);
});

test('modern Outlook requests include Office client diagnostics when available', async () => {
  const source = await readFile(managedSignatureUrl, 'utf8');
  assert.match(source, /mailboxDiagnostics\?\.hostName/);
  assert.match(source, /query\.set\('clientPlatform'/);
  assert.match(source, /query\.set\('officeVersion'/);
});
