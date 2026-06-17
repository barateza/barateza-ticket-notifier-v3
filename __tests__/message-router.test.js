/**
 * message-router.test.js
 * Unit tests for utils/message-router.js in isolation.
 */

import { MessageRouter } from '../utils/message-router.js';

describe('MessageRouter', () => {
    let router;

    beforeEach(() => {
        router = new MessageRouter();
    });

    describe('register() and createListener()', () => {
        test('dispatches to the correct handler for a registered action', (done) => {
            router.register('testAction', async (request, sendResponse) => {
                sendResponse({ handled: true, value: request.value });
            });

            const listener = router.createListener();
            listener(
                { action: 'testAction', value: 42 },
                {},
                (response) => {
                    expect(response).toEqual({ handled: true, value: 42 });
                    done();
                }
            );
        });

        test('returns error for unregistered action', (done) => {
            const listener = router.createListener();
            listener(
                { action: 'nonexistent' },
                {},
                (response) => {
                    expect(response).toEqual({ error: 'Unknown action' });
                    done();
                }
            );
        });

        test('handles multiple registered actions independently', (done) => {
            const results = [];

            router.register('actionA', async (req, sendResponse) => {
                sendResponse({ from: 'A' });
            });
            router.register('actionB', async (req, sendResponse) => {
                sendResponse({ from: 'B' });
            });

            const listener = router.createListener();

            listener({ action: 'actionA' }, {}, (res) => {
                results.push(res);
            });
            listener({ action: 'actionB' }, {}, (res) => {
                results.push(res);
                expect(results).toContainEqual({ from: 'A' });
                expect(results).toContainEqual({ from: 'B' });
                done();
            });
        });

        test('catches handler errors and sends error response', (done) => {
            router.register('broken', async (_request, _sendResponse) => {
                throw new Error('Handler crashed');
            });

            const listener = router.createListener();
            listener(
                { action: 'broken' },
                {},
                (response) => {
                    expect(response).toEqual({ error: 'Handler crashed' });
                    done();
                }
            );
        });

        test('returns true from listener to keep message channel open', () => {
            router.register('noop', async (req, sendResponse) => {
                sendResponse({ ok: true });
            });

            const listener = router.createListener();
            const result = listener({ action: 'noop' }, {}, () => {});

            expect(result).toBe(true);
        });
    });
});
