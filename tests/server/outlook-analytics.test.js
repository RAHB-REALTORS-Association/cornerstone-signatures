import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyOutlookClient } from '../../server/outlook-analytics.js';

describe('Outlook analytics classification', () => {
  it('recognizes Classic Outlook versions and primary-address use', () => {
    assert.deepEqual(
      classifyOutlookClient('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.20326; Pro)', 'person@example.com', 'PERSON@example.com'),
      { clientFamily: 'Classic Outlook for Windows', clientVersion: '16.0.20326', platform: 'Windows', usageType: 'primary' },
    );
  });

  it('recognizes mobile platforms and alternate From use', () => {
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15', 'person@example.com', 'support@example.com'),
      { clientFamily: 'Outlook for iOS', clientVersion: '18.7', platform: 'iOS', usageType: 'alternate_from' },
    );
    assert.deepEqual(
      classifyOutlookClient('Outlook-Android/4.2442.1 (Android 15)', 'person@example.com', 'person@example.com'),
      { clientFamily: 'Outlook for Android', clientVersion: '4.2442.1', platform: 'Android', usageType: 'primary' },
    );
  });

  it('uses Office diagnostics to distinguish every supported Outlook host', () => {
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (Windows NT 10.0)', 'person@example.com', 'person@example.com', {
        hostName: 'Outlook', hostVersion: '16.0.20326', platform: 'PC', officeVersion: '16.0.20326.1000',
      }),
      { clientFamily: 'Classic Outlook for Windows', clientVersion: '16.0.20326', platform: 'Windows', usageType: 'primary' },
    );
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6)', 'person@example.com', 'person@example.com', {
        hostName: 'Outlook', hostVersion: '16.101.0', platform: 'Mac', officeVersion: '16.101.0',
      }),
      { clientFamily: 'Outlook for Mac (desktop)', clientVersion: '16.101.0', platform: 'macOS', usageType: 'primary' },
    );
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (Windows NT 10.0)', 'person@example.com', 'person@example.com', {
        hostName: 'newOutlookWindows', hostVersion: '15.20.9999.1', platform: 'OfficeOnline', officeVersion: '20260914004.08',
      }),
      { clientFamily: 'New Outlook for Windows', clientVersion: '20260914004.08', platform: 'Windows', usageType: 'primary' },
    );
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', 'person@example.com', 'person@example.com', {
        hostName: 'OutlookWebApp', hostVersion: '15.20.9999.1', platform: 'OfficeOnline', officeVersion: '16.0',
      }),
      { clientFamily: 'Outlook on the web', clientVersion: '18.6', platform: 'macOS', usageType: 'primary' },
    );
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)', 'person@example.com', 'person@example.com', {
        hostName: 'OutlookIOS', hostVersion: '4.2537.0', platform: 'iOS',
      }),
      { clientFamily: 'Outlook for iOS', clientVersion: '4.2537.0', platform: 'iPadOS', usageType: 'primary' },
    );
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (Linux; Android 16)', 'person@example.com', 'support@example.com', {
        hostName: 'OutlookAndroid', hostVersion: '4.2537.1', platform: 'Android',
      }),
      { clientFamily: 'Outlook for Android', clientVersion: '4.2537.1', platform: 'Android', usageType: 'alternate_from' },
    );
  });

  it('does not mistake Outlook on the web on a Mac for the desktop client', () => {
    assert.deepEqual(
      classifyOutlookClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15', 'person@example.com', 'person@example.com'),
      { clientFamily: 'Outlook on the web', clientVersion: '18.6', platform: 'macOS', usageType: 'primary' },
    );
  });
});
