// ─── MessageRouter ─────────────────────────────────────────────────────────────
//
// Formalises the chrome.runtime.onMessage dispatch into a handler registry.
// Each action maps to a handler function that is independently testable.
//
// Interface (3 methods):
//   register(action, handler)  — register a handler for an action string
//   createListener()           — returns the callback for onMessage.addListener
//
// Handler signature:
//   handler(request, sendResponse) → called when request.action matches

export class MessageRouter {
  constructor() {
    /** @type {Map<string, function>} */
    this.handlers = new Map();
  }

  /**
   * Register a handler for a given action string.
   * @param {string} action
   * @param {(request: object, sendResponse: function) => Promise<void>} handler
   */
  register(action, handler) {
    this.handlers.set(action, handler);
  }

  /**
   * Create a listener function suitable for chrome.runtime.onMessage.addListener.
   * Each handler runs inside an async IIFE; the listener returns true to keep
   * the message channel open for async responses.
   * @returns {(request: object, sender: object, sendResponse: function) => boolean}
   */
  createListener() {
    return (request, sender, sendResponse) => {
      (async () => {
        const handler = this.handlers.get(request.action);
        if (handler) {
          try {
            await handler(request, sendResponse);
          } catch (error) {
            sendResponse({ error: error.message || 'Internal error' });
          }
        } else {
          sendResponse({ error: 'Unknown action' });
        }
      })();
      return true; // Keep message channel open for async response
    };
  }
}
