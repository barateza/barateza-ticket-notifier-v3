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

    chrome.storage.local.get.mockImplementation((keys, callback) => {
      const result = {};
      const list = typeof keys === 'string' ? [keys] : keys;
      list.forEach(k => { if (k === 'endpoints' || k === 'monitors') result[k] = endpoints; });
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    chrome.storage.local.set.mockImplementation((data, callback) => {
      if (data.monitors) endpoints.splice(0, endpoints.length, ...data.monitors);
      if (callback) callback();
      return Promise.resolve();
    });

    chrome.storage.local.remove.mockImplementation((_keys, callback) => {
      if (callback) callback();
      return Promise.resolve();
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

  test('groupMonitorsByProvider groups non-contiguous providers correctly', async () => {
    const { groupMonitorsByProvider } = await import('../popup-endpoints.js');
    const monitors = [
      { id: 1, name: 'Z1', provider: 'zendesk', url: 'https://a.zendesk.com/api/v2/search.json?query=q' },
      { id: 2, name: 'J1', provider: 'jira', url: 'https://a.atlassian.net/issues/?jql=q' },
      { id: 3, name: 'Z2', provider: 'zendesk', url: 'https://b.zendesk.com/api/v2/search.json?query=q' }
    ];

    const groups = groupMonitorsByProvider(monitors);

    expect(groups).toHaveLength(2);
    expect(groups[0].provider.id).toBe('zendesk');
    expect(groups[0].monitors.map(m => m.id)).toEqual([1, 3]);
    expect(groups[1].provider.id).toBe('jira');
    expect(groups[1].monitors.map(m => m.id)).toEqual([2]);
  });
});
