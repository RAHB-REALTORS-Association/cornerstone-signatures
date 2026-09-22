import mjml2html from 'mjml';
import { HttpError } from './errors.js';
import { safeTemplateHtml } from './validation.js';

const includePattern = /<\s*mj-include\b/i;

function bodyFragment(html) {
  const match = String(html).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return (match?.[1] || html).trim();
}

export async function compileMjml(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 200000) {
    throw new HttpError(400, 'invalid_mjml', 'MJML must be a non-empty string no longer than 200000 characters.');
  }
  if (includePattern.test(source)) {
    throw new HttpError(400, 'invalid_mjml', 'MJML includes are not supported. Add images and content directly in the visual editor.');
  }

  try {
    const result = await mjml2html(source.trim(), { validationLevel: 'strict', minify: false });
    if (result.errors?.length) {
      throw new HttpError(400, 'invalid_mjml', result.errors.map((error) => error.formattedMessage || error.message).join(' '));
    }
    return safeTemplateHtml(bodyFragment(result.html));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const detail = error?.errors?.map((item) => item.formattedMessage || item.message).filter(Boolean).join(' ');
    throw new HttpError(400, 'invalid_mjml', detail || String(error?.message || 'The MJML template could not be compiled.').replace(/^ValidationError:\s*/i, '').trim());
  }
}
