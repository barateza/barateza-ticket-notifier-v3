// ─── Popup Snooze Controls ─────────────────────────────────────────────────────
//
// Handles the snooze modal, snooze confirmation/cancellation, and
// live-updating snooze status display in the popup.
//
// Imports shared UI helpers from popup.js (circular import is safe in ES
// modules because these are called at runtime, not at module eval time).
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';
import { sendToSW, showLoading, hideLoading, showSuccess, showError } from './popup.js';

let snoozeTimer = null;

// ─── Modal ────────────────────────────────────────────────────────────────────

export function showSnoozeModal() {
    document.getElementById('snoozeModal').classList.remove('hidden');
    document.getElementById('snoozeDuration').focus();
}

export function hideSnoozeModal() {
    document.getElementById('snoozeModal').classList.add('hidden');
}

// ─── Confirm / Cancel ─────────────────────────────────────────────────────────

export async function handleConfirmSnooze() {
    const duration = parseInt(document.getElementById('snoozeDuration').value);
    try {
        showLoading('Snoozing notifications...');
        const response = await sendToSW({
            action: 'setSnooze',
            duration: duration
        });

        if (response && response.success) {
            hideSnoozeModal();
            showSuccess(duration === 0 ? 'Notifications snoozed indefinitely' : `Notifications snoozed for ${duration} minutes`);
            await updateSnoozeStatus();
        } else {
            showError('Failed to snooze notifications');
        }
    } catch (error) {
        Logger.error('Error snoozing notifications:', error);
        showError('Failed to snooze notifications');
    } finally {
        hideLoading();
    }
}

export async function handleCancelSnooze() {
    try {
        showLoading('Canceling snooze...');
        const response = await sendToSW({
            action: 'clearSnooze'
        });

        if (response && response.success) {
            await updateSnoozeStatus();
            showSuccess('Notifications no longer snoozed');
        } else {
            showError('Failed to cancel snooze');
        }
    } catch (error) {
        Logger.error('Error canceling snooze:', error);
        showError('Failed to cancel snooze');
    } finally {
        hideLoading();
    }
}

// ─── Status Display ───────────────────────────────────────────────────────────

export async function updateSnoozeStatus() {
    try {
        const response = await sendToSW({
            action: 'getSnoozeStatus'
        });

        Logger.info('updateSnoozeStatus received:', response);

        if (!response) return;

        const snoozeStatus = document.getElementById('snoozeStatus');
        const snoozeRemaining = document.getElementById('snoozeRemaining');

        if (response.isSnoozed) {
            Logger.info('Snooze is active, showing banner');
            snoozeStatus.classList.remove('hidden');
            // remainingTime === 0 means indefinite snooze
            if (response.remainingTime === 0) {
                snoozeRemaining.textContent = 'Until I turn back on';
            } else if (response.remainingTime === 1) {
                snoozeRemaining.textContent = 'Less than 1 minute remaining';
            } else if (response.remainingTime < 60) {
                snoozeRemaining.textContent = `${response.remainingTime} minutes remaining`;
            } else {
                const hours = Math.floor(response.remainingTime / 60);
                const minutes = response.remainingTime % 60;
                snoozeRemaining.textContent = `${hours}h ${minutes}m remaining`;
            }
        } else {
            Logger.info('Snooze is not active, hiding banner');
            snoozeStatus.classList.add('hidden');
        }
    } catch (error) {
        Logger.error('Error getting snooze status:', error);
    }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

export function startSnoozeTimer() {
    // Clear any existing timer first (prevents leaks)
    stopSnoozeTimer();

    snoozeTimer = setInterval(async () => {
        await updateSnoozeStatus();

        // Check if snooze is still active
        try {
            const response = await sendToSW({
                action: 'getSnoozeStatus'
            });

            if (!response || !response.isSnoozed) {
                clearInterval(snoozeTimer);
                snoozeTimer = null;
            }
        } catch (_error) {
            clearInterval(snoozeTimer);
            snoozeTimer = null;
        }
    }, 60000); // Update every minute
}

export function stopSnoozeTimer() {
    if (snoozeTimer !== null) {
        clearInterval(snoozeTimer);
        snoozeTimer = null;
    }
}
