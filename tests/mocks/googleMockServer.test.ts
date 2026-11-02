import test from 'node:test';
import assert from 'node:assert/strict';
import { MockGoogleServer } from './googleMockServer.js';

test('MockGoogleServer starts, handles OAuth token exchange, and shuts down', async () => {
  const mockServer = new MockGoogleServer();
  const baseUrl = await mockServer.start();
  try {
    assert.ok(baseUrl.startsWith('http://127.0.0.1:'));

    // Test /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');

    // Test /token exchange
    const tokenRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: 'test_code_1',
        client_id: 'client_id_val',
        client_secret: 'client_secret_val',
        redirect_uri: 'http://localhost:3001/callback',
        grant_type: 'authorization_code',
      }),
    });
    assert.equal(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.ok(tokenData.access_token);
    assert.ok(tokenData.refresh_token);
    assert.equal(tokenData.expires_in, 3600);

    // Test user info
    const userRes = await fetch(`${baseUrl}/oauth2/v2/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(userRes.status, 200);
    const user = await userRes.json();
    assert.equal(user.email, 'parent1@example.com');

    // Test Calendar List
    const calListRes = await fetch(`${baseUrl}/calendar/v3/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(calListRes.status, 200);
    const calList = await calListRes.json();
    assert.ok(Array.isArray(calList.items));
    assert.equal(calList.items.length, 3);

    // Test Events list
    const eventsRes = await fetch(`${baseUrl}/calendar/v3/calendars/primary/events`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(eventsRes.status, 200);
    const eventsData = await eventsRes.json();
    assert.ok(eventsData.items.length >= 2);

    // Test 410 Gone simulation
    const expiredRes = await fetch(`${baseUrl}/calendar/v3/calendars/primary/events?syncToken=expired-token`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(expiredRes.status, 410);

    // Test 503 offline simulation
    mockServer.isOffline = true;
    const offlineRes = await fetch(`${baseUrl}/calendar/v3/calendars/primary/events`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(offlineRes.status, 503);
    mockServer.isOffline = false;

    // Test Photos Picker API
    const sessionRes = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(sessionRes.status, 200);
    const sess = await sessionRes.json();
    assert.ok(sess.id);
    assert.ok(sess.pickerUri);

    const mediaRes = await fetch(`${baseUrl}/v1/mediaItems?sessionId=${sess.id}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert.equal(mediaRes.status, 200);
    const mediaData = await mediaRes.json();
    assert.ok(mediaData.mediaItems.length >= 2);

    // Download media
    const dlRes = await fetch(mediaData.mediaItems[0].mediaFile.baseUrl);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers.get('content-type'), 'image/jpeg');
  } catch (err) {
    console.error('TEST ERROR OCCURRED:', err);
    throw err;
  } finally {
    await mockServer.stop();
  }
});
