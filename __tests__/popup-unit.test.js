describe('popup.js exported functions', () => {
  const endpoints = [
    {
      id: 1,
      name: 'My Tickets',
      url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new',
      enabled: true
    }
  ];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    document.body.innerHTML = `
      <div id="endpointsList"></div>
      <div id="snoozeStatus" class="hidden"></div>
      <div id="snoozeRemaining"></div>
    `;

    const originalAddEventListener = document.addEventListener.bind(document);
    jest.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'DOMContentLoaded') return;
      originalAddEventListener(type, listener, options);
    });

    chrome.storage.local.get.mockImplementation((keys) => {
      if (Array.isArray(keys) && keys.includes('endpoints')) {
        return Promise.resolve({ endpoints });
      }
      return Promise.resolve({});
    });

    chrome.runtime.sendMessage.mockResolvedValue({
      isSnoozed: true,
      remainingTime: 0
    });

    chrome.cookies.getAll.mockResolvedValue([{ name: 'session-id', value: 'abc123' }]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 3 })
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('loadEndpoints renders endpoint rows', async () => {
    const popup = await import('../popup.js');
    await popup.loadEndpoints();

    const list = document.getElementById('endpointsList');
    expect(list.textContent).toContain('My Tickets');
    expect(list.querySelectorAll('.endpoint-item')).toHaveLength(1);
  });

  test('updateSnoozeStatus shows indefinite snooze text', async () => {
    const popup = await import('../popup.js');
    await popup.updateSnoozeStatus();

    expect(document.getElementById('snoozeStatus').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('snoozeRemaining').textContent).toBe('Until I turn back on');
  });

  test('testEndpoint returns success for valid api response', async () => {
    const popup = await import('../popup.js');
    const result = await popup.testEndpoint(endpoints[0].url);

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
  });

  test('testEndpoint tells the user to log in when there are no cookies', async () => {
    chrome.cookies.getAll.mockResolvedValue([]);
    global.fetch = jest.fn();

    const popup = await import('../popup.js');
    const result = await popup.testEndpoint(endpoints[0].url);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not logged in to cpanel.zendesk.com');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('testEndpoint reports rate limiting the same way the poller does', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (key) => (key === 'Retry-After' ? '60' : null) }
    });

    const popup = await import('../popup.js');
    const result = await popup.testEndpoint(endpoints[0].url);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Rate limited by Zendesk');
  });

  test('testEndpoint reports a bare HTTP status when the body is not the API shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    });

    const popup = await import('../popup.js');
    const result = await popup.testEndpoint(endpoints[0].url);

    expect(result).toEqual({ success: false, message: 'HTTP 401: Unauthorized' });
  });
});
