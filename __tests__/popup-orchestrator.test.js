/**
 * popup-orchestrator.test.js
 * Tests for the core orchestration functions in popup.js.
 * Exercises them directly (they were made exportable for testing).
 */

describe('popup.js orchestration', () => {
  let popup;

  beforeAll(async () => {
    // Minimal DOM needed by the functions
    document.body.innerHTML = `
      <button id="refreshBtn"></button>
      <button id="toggleBtn" data-enabled="true"></button>
      <div id="statusText"></div>
      <div class="status-dot"></div>
      <div id="lastCheck"></div>
      <div class="section"></div>
      <div id="loadingOverlay" class="hidden"><div class="loading-content"><p></p></div></div>
    `;

    // Suppress DOMContentLoaded auto-init
    jest.spyOn(document, 'addEventListener').mockImplementation((type) => {
      if (type === 'DOMContentLoaded') return;
    });

    popup = await import('../popup.js');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.getElementById('refreshBtn').disabled = false;
    document.getElementById('refreshBtn').innerHTML = '';
    document.getElementById('toggleBtn').dataset.enabled = 'true';
    document.getElementById('toggleBtn').innerHTML = '';
  });

  // ─── handleToggleMonitoring ─────────────────────────────────────────────

  describe('handleToggleMonitoring', () => {
    test('sends toggleEnabled with enabled=false when currently enabled', async () => {
      document.getElementById('toggleBtn').dataset.enabled = 'true';
      chrome.runtime.sendMessage.mockResolvedValue({ success: true });

      await popup.handleToggleMonitoring();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'toggleEnabled', enabled: false })
      );
    });

    test('sends toggleEnabled with enabled=true when currently disabled', async () => {
      document.getElementById('toggleBtn').dataset.enabled = 'false';
      chrome.runtime.sendMessage.mockResolvedValue({ success: true });

      await popup.handleToggleMonitoring();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'toggleEnabled', enabled: true })
      );
    });

    test('updates button text on success', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true });

      await popup.handleToggleMonitoring();

      expect(document.getElementById('toggleBtn').dataset.enabled).toBe('false');
    });

    test('handles failure gracefully', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: false });

      await expect(popup.handleToggleMonitoring()).resolves.not.toThrow();
    });
  });

  // ─── handleRefreshNow ───────────────────────────────────────────────────

  describe('handleRefreshNow', () => {
    test('sends refreshNow message', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true });

      await popup.handleRefreshNow();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'refreshNow' })
      );
    });

    test('handles SW unavailable gracefully', async () => {
      chrome.runtime.sendMessage.mockRejectedValue(new Error('SW terminated'));

      await expect(popup.handleRefreshNow()).resolves.not.toThrow();
    });

    test('re-enables button after completion', async () => {
      const btn = document.getElementById('refreshBtn');
      btn.disabled = true;
      chrome.runtime.sendMessage.mockResolvedValue({ success: true });

      await popup.handleRefreshNow();

      expect(btn.disabled).toBe(false);
    });
  });
});
