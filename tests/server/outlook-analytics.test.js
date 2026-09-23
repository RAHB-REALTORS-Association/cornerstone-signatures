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
});
