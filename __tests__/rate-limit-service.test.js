/**
 * rate-limit-service.test.js
 * Unit tests for utils/rate-limit-service.js in isolation.
 */

import * as rateLimitService from '../utils/rate-limit-service.js';

describe('RateLimitService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rateLimitService.clear();
        chrome.alarms.create.mockImplementation(() => {});
        chrome.alarms.clear.mockResolvedValue(true);
    });

    describe('isLimited()', () => {
        test('returns false when no rate limit recorded', () => {
            expect(rateLimitService.isLimited()).toBe(false);
        });

        test('returns true when rate limit is active', () => {
            rateLimitService.record('60');

            expect(rateLimitService.isLimited()).toBe(true);
        });

        test('returns false after rate limit expires', () => {
            // Record with a time in the past
            const spy = jest.spyOn(Date, 'now').mockReturnValue(1000000);
            rateLimitService.record('1');
            spy.mockReturnValue(2000000); // 1 second later

            expect(rateLimitService.isLimited()).toBe(false);

            spy.mockRestore();
        });
    });

    describe('record()', () => {
        test('parses seconds and creates alarm', () => {
            rateLimitService.record('120');

            expect(chrome.alarms.clear).toHaveBeenCalledWith('ticketCheck');
            expect(chrome.alarms.create).toHaveBeenCalledWith(
                'rateLimitResume',
                expect.objectContaining({ delayInMinutes: expect.any(Number) })
            );
        });

        test('ignores missing header', () => {
            rateLimitService.record(null);

            expect(chrome.alarms.create).not.toHaveBeenCalled();
        });

        test('ignores invalid header', () => {
            rateLimitService.record('not-a-number');

            expect(chrome.alarms.create).not.toHaveBeenCalled();
        });

        test('ignores expired timestamp', () => {
            rateLimitService.record('0');

            expect(chrome.alarms.create).not.toHaveBeenCalled();
        });
    });

    describe('clear()', () => {
        test('resets limited state', () => {
            rateLimitService.record('60');
            expect(rateLimitService.isLimited()).toBe(true);

            rateLimitService.clear();

            expect(rateLimitService.isLimited()).toBe(false);
        });
    });

    describe('rescheduleIfLimited()', () => {
        test('recreates the alarm when still rate-limited', () => {
            rateLimitService.record('120');

            jest.clearAllMocks();
            rateLimitService.rescheduleIfLimited();

            expect(chrome.alarms.create).toHaveBeenCalledWith(
                'rateLimitResume',
                expect.any(Object)
            );
        });

        test('does nothing when not rate-limited', () => {
            rateLimitService.rescheduleIfLimited();

            expect(chrome.alarms.create).not.toHaveBeenCalled();
        });
    });
});
