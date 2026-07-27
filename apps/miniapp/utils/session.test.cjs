const test = require('node:test');
const assert = require('node:assert/strict');

function loadSession(wxMock) {
  global.wx = wxMock;
  delete require.cache[require.resolve('./session')];
  return require('./session');
}

test('logs in once and persists the Bearer session token', async () => {
  const storage = {};
  let loginCalls = 0;
  const session = loadSession({
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: (key) => { delete storage[key]; },
    login: ({ success }) => {
      loginCalls += 1;
      success({ code: 'wx-code-a' });
    },
    request: ({ success }) => success({
      statusCode: 200,
      data: { success: true, data: { token: 'session-token-123456', user: { id: 'user-a' } } },
    }),
  });

  const [first, second] = await Promise.all([
    session.ensureSession('https://api.example.test'),
    session.ensureSession('https://api.example.test'),
  ]);

  assert.equal(first, 'session-token-123456');
  assert.equal(second, first);
  assert.equal(loginCalls, 1);
  assert.deepEqual(session.getAuthorizationHeader(), {
    Authorization: 'Bearer session-token-123456',
  });
});

test('clears an invalid session before a one-shot relogin', async () => {
  const storage = { community_selection_session: { token: 'old-token' } };
  const session = loadSession({
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: (key) => { delete storage[key]; },
    login: ({ success }) => success({ code: 'wx-code-b' }),
    request: ({ success }) => success({
      statusCode: 200,
      data: { success: true, data: { token: 'new-session-token', user: { id: 'user-b' } } },
    }),
  });

  session.clearSession();
  assert.equal(await session.ensureSession('https://api.example.test'), 'new-session-token');
});
