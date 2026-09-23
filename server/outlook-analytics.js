function clean(value, max = 80) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function version(match) { return match?.[1] || ''; }

function webPlatform(userAgent) {
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPad/i.test(userAgent)) return 'iPadOS';
  if (/iPhone|iPod/i.test(userAgent)) return 'iOS';
  if (/CrOS/i.test(userAgent)) return 'ChromeOS';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Other';
}

function browserVersion(userAgent) {
  return version(userAgent.match(/(?:EdgA|EdgiOS|Edg|CriOS|Chrome|FxiOS|Firefox)\/([\d.]+)/i))
    || version(userAgent.match(/Version\/([\d.]+).*Safari/i));
}

function usageType(identityEmail, senderEmail) {
  const identity = String(identityEmail || '').trim().toLocaleLowerCase('en-CA');
  const sender = String(senderEmail || identityEmail || '').trim().toLocaleLowerCase('en-CA');
  return identity && sender === identity ? 'primary' : 'alternate_from';
}

export function classifyOutlookClient(userAgent, identityEmail, senderEmail, hints = {}) {
  const ua = String(userAgent || '').slice(0, 240);
  const hostName = clean(hints.hostName).toLocaleLowerCase('en-CA');
  const hostVersion = clean(hints.hostVersion);
  const officePlatform = clean(hints.platform).toLocaleLowerCase('en-CA');
  const officeVersion = clean(hints.officeVersion);
  let clientFamily = 'Outlook (unknown client)';
  let clientVersion = '';
  let platform = 'Unknown';

  if (hostName === 'outlookios') {
    clientFamily = 'Outlook for iOS';
    clientVersion = hostVersion || officeVersion;
    platform = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
  } else if (hostName === 'outlookandroid') {
    clientFamily = 'Outlook for Android';
    clientVersion = hostVersion || officeVersion;
    platform = 'Android';
  } else if (hostName === 'newoutlookwindows') {
    clientFamily = 'New Outlook for Windows';
    clientVersion = officeVersion;
    platform = 'Windows';
  } else if (hostName === 'outlookwebapp') {
    clientFamily = 'Outlook on the web';
    clientVersion = browserVersion(ua);
    platform = webPlatform(ua);
  } else if (hostName === 'outlook' && officePlatform === 'mac') {
    clientFamily = 'Outlook for Mac (desktop)';
    clientVersion = hostVersion || officeVersion;
    platform = 'macOS';
  } else if (hostName === 'outlook' && ['pc', 'universal'].includes(officePlatform)) {
    clientFamily = 'Classic Outlook for Windows';
    clientVersion = hostVersion || officeVersion;
    platform = 'Windows';
  } else {
    let match = ua.match(/Outlook-(?:iOS|iPhone)\/?([\d.]+)?/i);
    if (match || /(?:iPhone|iPad|iPod)/i.test(ua)) {
      clientFamily = 'Outlook for iOS';
      clientVersion = hostVersion || version(match) || version(ua.match(/OS ([\d_]+)/i)).replaceAll('_', '.');
      platform = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
    } else if ((match = ua.match(/Outlook-Android\/?([\d.]+)?/i)) || /Android/i.test(ua)) {
      clientFamily = 'Outlook for Android';
      clientVersion = hostVersion || version(match) || version(ua.match(/Android\s+([\d.]+)/i));
      platform = 'Android';
    } else if ((match = ua.match(/Microsoft Outlook\s+([\d.]+)/i)) && /Windows NT/i.test(ua)) {
      clientFamily = 'Classic Outlook for Windows';
      clientVersion = hostVersion || version(match);
      platform = 'Windows';
    } else if ((match = ua.match(/Microsoft Office\/([\d.]+).*Microsoft Outlook\s+([\d.]+)/i))) {
      clientFamily = 'Classic Outlook for Windows';
      clientVersion = hostVersion || match[2] || match[1] || '';
      platform = /Windows/i.test(ua) ? 'Windows' : 'Unknown';
    } else if (/Macintosh|Mac OS X/i.test(ua) && /(?:Microsoft )?Outlook[\s/]/i.test(ua)) {
      clientFamily = 'Outlook for Mac (desktop)';
      clientVersion = hostVersion || version(ua.match(/(?:Outlook|Microsoft Outlook)[\s/]([\d.]+)/i));
      platform = 'macOS';
    } else if (/Windows NT/i.test(ua)) {
      clientFamily = 'New Outlook or Outlook on the web';
      clientVersion = browserVersion(ua);
      platform = 'Windows';
    } else if (/Mozilla|AppleWebKit|Chrome|Safari/i.test(ua)) {
      clientFamily = 'Outlook on the web';
      clientVersion = browserVersion(ua);
      platform = webPlatform(ua);
    }
  }

  return { clientFamily, clientVersion, platform, usageType: usageType(identityEmail, senderEmail) };
}
