import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../../outlook-addin/src/classic-runtime-entry.js', import.meta.url);
const manifestUrl = new URL('../../outlook-addin/manifest.template.xml', import.meta.url);

test('classic Outlook runtime avoids unsupported JavaScript syntax', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const unsupported = [
    /=>/,
    /\basync\s+(?:function|\()/,
    /\bawait\b/,
    /\?\./,
    /\?\?/,
    /`/,
    /^\s*import\s/m,
  ];

  for (const pattern of unsupported) assert.doesNotMatch(source, pattern);
  assert.match(source, /OfficeRuntime\.auth\.getAccessToken/);
  assert.match(source, /var SIGNATURE_URL = __SIGNATURE_URL__/);
  assert.match(source, /Office\.actions\.associate\('applyCornerstoneSignature'/);
  assert.match(source, /Office\.actions\.associate\('refreshCornerstoneSignature'/);
});

test('manifest gives classic Outlook a separate runtime and legacy SSO metadata', async () => {
  const manifest = await readFile(manifestUrl, 'utf8');

  assert.match(manifest, /<Version>2\.0\.0\.0<\/Version>/);
  assert.match(manifest, /<Override type="javascript" resid="ClassicRuntime\.Js"\/>/);
  assert.match(manifest, /<bt:Url id="ClassicRuntime\.Js" DefaultValue="__PUBLIC_BASE_URL__\/outlook-addin\/dist\/classic-runtime-entry\.js"\/>/);
  assert.match(manifest, /<WebApplicationInfo>[\s\S]*<Id>__MICROSOFT_CLIENT_ID__<\/Id>[\s\S]*<Resource>api:\/\/__PUBLIC_HOST__\/__MICROSOFT_CLIENT_ID__<\/Resource>/);
});
