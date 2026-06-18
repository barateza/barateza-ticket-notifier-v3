/**
 * Logger utility for Zendesk Ticket Monitor
 * Provides conditional logging based on debug mode settings.
 */

class LoggerInstance {
    constructor() {
        this.debugEnabled = false;
    }

    /**
     * Set the debug mode state
     * @param {boolean} enabled 
     */
    setDebugMode(enabled) {
        this.debugEnabled = !!enabled;
    }

    /**
     * Log info messages if debug mode is enabled
     * @param  {...any} args 
     */
    info(...args) {
        if (this.debugEnabled) {
            console.warn('[INFO]', ...args);
        }
    }

    /**
     * Log warning messages if debug mode is enabled
     * @param  {...any} args 
     */
    warn(...args) {
        if (this.debugEnabled) {
            console.warn(...args);
        }
    }

    /**
     * Log error messages (always logged to ensure critical issues are visible, 
     * but can be gated if preferred)
     * @param  {...any} args 
     */
    error(...args) {
        // Always log errors regardless of debug mode to ensure critical issues are visible.
        // Design decision (v3.4.3): maintaining error visibility was preferred over
        // suppressing it in production, even though endpoint URLs may appear in console.
        // Rationale: silent failures in production are harder to diagnose than
        // the marginal risk of console exposure on shared devices.
        console.error(...args);
    }
}

export const Logger = new LoggerInstance();
export default Logger;
