function version(match) { return match?.[1] || ''; }

export function classifyOutlookClient(userAgent, identityEmail, senderEmail) {
  const ua = String(userAgent || '').slice(0, 240);
  let clientFamily = 'Outlook (unknown client)';
  let clientVersion = '';
  let platform = 'Unknown';

  let match = ua.match(/Outlook-(?:iOS|iPhone)\/?([\d.]+)?/i);
  if (match || /(?:iPhone|iPad|iPod)/i.test(ua)) {
    clientFamily = 'Outlook for iOS';
    clientVersion = version(match) || version(ua.match(/OS ([\d_]+)/i)).replaceAll('_', '.');
    platform = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
  } else if ((match = ua.match(/Outlook-Android\/?([\d.]+)?/i)) || /Android/i.test(ua)) {
    clientFamily = 'Outlook for Android';
    clientVersion = version(match) || version(ua.match(/Android\s+([\d.]+)/i));
    platform = 'Android';
  } else if ((match = ua.match(/Microsoft Outlook\s+([\d.]+)/i)) && /Windows NT/i.test(ua)) {
    clientFamily = 'Classic Outlook for Windows';
    clientVersion = version(match);
    platform = 'Windows';
  } else if ((match = ua.match(/Microsoft Office\/([\d.]+).*Microsoft Outlook\s+([\d.]+)/i))) {
    clientFamily = 'Classic Outlook for Windows';
    clientVersion = match[2] || match[1] || '';
    platform = /Windows/i.test(ua) ? 'Windows' : 'Unknown';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    clientFamily = 'Outlook for Mac';
    clientVersion = version(ua.match(/(?:Outlook|Microsoft Outlook)[\s/]([\d.]+)/i));
    platform = 'macOS';
  } else if (/Windows NT/i.test(ua)) {
    clientFamily = 'New Outlook or Outlook on the web';
    clientVersion = version(ua.match(/(?:Edg|Chrome)\/([\d.]+)/i));
    platform = 'Windows';
  } else if (/Mozilla|AppleWebKit|Chrome|Safari/i.test(ua)) {
    clientFamily = 'Outlook on the web';
    clientVersion = version(ua.match(/(?:Edg|Chrome|Version)\/([\d.]+)/i));
    platform = 'Web';
  }

  const identity = String(identityEmail || '').trim().toLocaleLowerCase('en-CA');
  const sender = String(senderEmail || identityEmail || '').trim().toLocaleLowerCase('en-CA');
  return {
    clientFamily,
    clientVersion,
    platform,
    usageType: identity && sender === identity ? 'primary' : 'alternate_from',
  };
}
