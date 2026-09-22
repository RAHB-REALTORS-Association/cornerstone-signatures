import { readFile, writeFile } from 'node:fs/promises';

const required = ['PUBLIC_BASE_URL', 'OUTLOOK_ADDIN_ID', 'OUTLOOK_PROVIDER_NAME', 'MICROSOFT_CLIENT_ID'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

const baseUrl = new URL(process.env.PUBLIC_BASE_URL);
if (baseUrl.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS for an Outlook deployment.');
const xmlEscape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const values = {
  PUBLIC_BASE_URL: baseUrl.href.replace(/\/$/, ''),
  PUBLIC_HOST: baseUrl.host,
  OUTLOOK_ADDIN_ID: process.env.OUTLOOK_ADDIN_ID,
  OUTLOOK_PROVIDER_NAME: process.env.OUTLOOK_PROVIDER_NAME,
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
};
let manifest = await readFile(new URL('../outlook-addin/manifest.template.xml', import.meta.url), 'utf8');
for (const [name, value] of Object.entries(values)) manifest = manifest.replaceAll(`__${name}__`, xmlEscape(value));
await writeFile(new URL('../outlook-addin/manifest.xml', import.meta.url), manifest);
console.log('Generated outlook-addin/manifest.xml.');
