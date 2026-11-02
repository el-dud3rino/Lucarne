import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGoogleError } from '../../src/server/services/googleErrors.js';

test('SERVICE_DISABLED becomes a short message with the enable link', () => {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: 'Google Photos Picker API has not been used in project 123 before or it is disabled...',
      status: 'PERMISSION_DENIED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'SERVICE_DISABLED',
          metadata: {
            serviceTitle: 'Google Photos Picker API',
            activationUrl: 'https://console.developers.google.com/apis/api/photospicker.googleapis.com/overview?project=123',
          },
        },
      ],
    },
  });
  const msg = describeGoogleError('Google Photos Picker API', 403, body);
  assert.match(msg, /^Google Photos Picker API isn't enabled in your Google Cloud project\./);
  assert.match(msg, /https:\/\/console\.developers\.google\.com\/apis\/api\/photospicker\.googleapis\.com\/overview\?project=123/);
  assert.ok(msg.length < 260, 'short, not a JSON dump');
});

test('missing scope tells the user to reconnect', () => {
  const body = JSON.stringify({ error: { code: 403, details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } });
  assert.match(describeGoogleError('Google Photos Picker API', 403, body), /Disconnect the account in Settings and connect it again/);
});

test('expired/revoked sign-in (401 and invalid_grant)', () => {
  assert.match(describeGoogleError('Google Calendar API', 401, '{}'), /expired or was revoked/);
  assert.match(
    describeGoogleError('Google sign-in refresh', 400, JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })),
    /expired or was revoked/
  );
});

test('rate limits, server errors, and unknown errors', () => {
  assert.match(describeGoogleError('Google Calendar API', 429, '{}'), /temporarily limiting/);
  assert.match(describeGoogleError('Google Calendar API', 503, 'Service Unavailable'), /Google's side \(HTTP 503\)/);
  assert.equal(
    describeGoogleError('Google Calendar API', 400, JSON.stringify({ error: { message: 'Bad timeMin' } })),
    'Google Calendar API error (HTTP 400): Bad timeMin'
  );
  assert.equal(describeGoogleError('Google Calendar API', 418, ''), 'Google Calendar API error (HTTP 418): no details');
});
