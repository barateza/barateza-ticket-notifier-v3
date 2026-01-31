// Zendesk Ticket Monitor - Popup Script
// Handles user interface interactions and settings management

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Popup loaded');

    // Initialize UI
    await loadSettings();
    await loadEndpoints();
    await updateStatus();

    // Set up event listeners
    setupEventListeners();

    // Update last check time
    updateLastCheckTime();
});

// Set up all event listeners
function setupEventListeners() {
    // Control buttons
    document.getElementById('refreshBtn').addEventListener('click', handleRefreshNow);
    document.getElementById('toggleBtn').addEventListener('click', handleToggleMonitoring);

    // Settings
    document.getElementById('soundEnabled').addEventListener('change', saveSettings);
    document.getElementById('notificationEnabled').addEventListener('change', saveSettings);
    document.getElementById('checkInterval').addEventListener('change', saveSettings);

    // Endpoint management
    document.getElementById('addEndpointBtn').addEventListener('click', showAddEndpointModal);
    document.getElementById('closeModal').addEventListener('click', hideAddEndpointModal);
    document.getElementById('cancelEndpoint').addEventListener('click', hideAddEndpointModal);
    document.getElementById('saveEndpoint').addEventListener('click', handleSaveEndpoint);

    // Close modal when clicking outside
    document.getElementById('addEndpointModal').addEventListener('click', (e) => {
        if (e.target.id === 'addEndpointModal') {
            hideAddEndpointModal();
        }
    });
}

// Load and display current settings
async function loadSettings() {
    try {
        const { settings } = await chrome.storage.local.get(['settings']);

        if (settings) {
            document.getElementById('soundEnabled').checked = settings.soundEnabled !== false;
            document.getElementById('notificationEnabled').checked = settings.notificationEnabled !== false;
            document.getElementById('checkInterval').value = settings.checkInterval || 1;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showError('Failed to load settings');
    }
}

// Save settings to storage
async function saveSettings() {
    try {
        const settings = {
            soundEnabled: document.getElementById('soundEnabled').checked,
            notificationEnabled: document.getElementById('notificationEnabled').checked,
            checkInterval: parseInt(document.getElementById('checkInterval').value)
        };

        await chrome.storage.local.set({ settings });
        console.log('Settings saved:', settings);

        // Update alarm interval if changed
        if (settings.checkInterval !== 1) {
            await chrome.alarms.clear('ticketCheck');
            await chrome.alarms.create('ticketCheck', { 
                periodInMinutes: settings.checkInterval 
            });
        }

    } catch (error) {
        console.error('Error saving settings:', error);
        showError('Failed to save settings');
    }
}

// Load and display endpoints
async function loadEndpoints() {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);
        const endpointsList = document.getElementById('endpointsList');

        if (!endpoints || endpoints.length === 0) {
            endpointsList.innerHTML = '<div class="error">No endpoints configured</div>';
            return;
        }

        endpointsList.innerHTML = '';

        endpoints.forEach((endpoint, index) => {
            const endpointElement = createEndpointElement(endpoint, index);
            endpointsList.appendChild(endpointElement);
        });

    } catch (error) {
        console.error('Error loading endpoints:', error);
        showError('Failed to load endpoints');
    }
}

// Create DOM element for an endpoint
function createEndpointElement(endpoint, index) {
    const div = document.createElement('div');
    div.className = 'endpoint-item';

    const truncatedUrl = endpoint.url.length > 60 ? 
        endpoint.url.substring(0, 60) + '...' : 
        endpoint.url;

    div.innerHTML = `
        <div class="endpoint-info">
            <div class="endpoint-name">${escapeHtml(endpoint.name)}</div>
            <div class="endpoint-url">${escapeHtml(truncatedUrl)}</div>
            <div class="endpoint-status ${endpoint.enabled ? 'active' : 'inactive'}">
                ${endpoint.enabled ? '● Active' : '○ Inactive'}
            </div>
        </div>
        <div class="endpoint-actions">
            <button class="btn btn-secondary" onclick="toggleEndpoint(${index})">
                ${endpoint.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-danger" onclick="deleteEndpoint(${index})">
                Delete
            </button>
        </div>
    `;

    return div;
}

// Toggle endpoint enabled/disabled
window.toggleEndpoint = async function(index) {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (endpoints && endpoints[index]) {
            endpoints[index].enabled = !endpoints[index].enabled;
            const saved = await saveEndpoints(endpoints);
            if (saved) {
                await loadEndpoints();
                showSuccess(`Endpoint ${endpoints[index].enabled ? 'enabled' : 'disabled'}`);
            }
        }
    } catch (error) {
        console.error('Error toggling endpoint:', error);
        showError('Failed to toggle endpoint');
    }
};

// Delete an endpoint
window.deleteEndpoint = async function(index) {
    if (!confirm('Are you sure you want to delete this endpoint?')) {
        return;
    }

    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (endpoints && endpoints[index]) {
            endpoints.splice(index, 1);
            const saved = await saveEndpoints(endpoints);
            if (saved) {
                await loadEndpoints();
                showSuccess('Endpoint deleted');
            }
        }
    } catch (error) {
        console.error('Error deleting endpoint:', error);
        showError('Failed to delete endpoint');
    }
};

// Handle refresh now button
async function handleRefreshNow() {
    const btn = document.getElementById('refreshBtn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
        btn.disabled = true;

        const response = await chrome.runtime.sendMessage({ action: 'refreshNow' });

        if (response && response.success) {
            showSuccess('Manual refresh completed');
            await updateStatus();
        } else {
            showError('Refresh failed');
        }
    } catch (error) {
        console.error('Error during refresh:', error);
        showError('Refresh failed');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        updateLastCheckTime();
    }
}

// Handle toggle monitoring button
async function handleToggleMonitoring() {
    const btn = document.getElementById('toggleBtn');
    const isEnabled = btn.dataset.enabled === 'true';
    const newState = !isEnabled;

    try {
        const response = await chrome.runtime.sendMessage({ 
            action: 'toggleEnabled', 
            enabled: newState 
        });

        if (response && response.success) {
            btn.dataset.enabled = newState.toString();
            btn.innerHTML = newState ? 
                '<span class="btn-icon">⏸️</span> Pause' : 
                '<span class="btn-icon">▶️</span> Resume';

            await updateStatus();
            showSuccess(`Monitoring ${newState ? 'resumed' : 'paused'}`);
        }
    } catch (error) {
        console.error('Error toggling monitoring:', error);
        showError('Failed to toggle monitoring');
    }
}

// Update status indicator
async function updateStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getStatus' });

        if (response) {
            const statusDot = document.querySelector('.status-dot');
            const statusText = document.getElementById('statusText');
            const toggleBtn = document.getElementById('toggleBtn');

            if (response.enabled) {
                statusDot.classList.remove('paused');
                statusText.textContent = 'Monitoring';
                toggleBtn.innerHTML = '<span class="btn-icon">⏸️</span> Pause';
                toggleBtn.dataset.enabled = 'true';
            } else {
                statusDot.classList.add('paused');
                statusText.textContent = 'Paused';
                toggleBtn.innerHTML = '<span class="btn-icon">▶️</span> Resume';
                toggleBtn.dataset.enabled = 'false';
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
    }
}

// Show add endpoint modal
function showAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.remove('hidden');
    document.getElementById('endpointName').focus();
}

// Hide add endpoint modal
function hideAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.add('hidden');
    document.getElementById('endpointName').value = '';
    document.getElementById('endpointUrl').value = '';
}

// Handle save endpoint
async function handleSaveEndpoint() {
    const name = document.getElementById('endpointName').value.trim();
    const url = document.getElementById('endpointUrl').value.trim();

    // Validation
    if (!name) {
        showError('Please enter a name for the endpoint');
        return;
    }

    if (name.length > 50) {
        showError('Endpoint name must be less than 50 characters');
        return;
    }

    if (!url) {
        showError('Please enter a URL for the endpoint');
        return;
    }

    // Validate URL format
    try {
        const urlObj = new URL(url);
        if (!urlObj.hostname.includes('zendesk.com')) {
            showError('URL must be a Zendesk domain (*.zendesk.com)');
            return;
        }
        
        // Validate URL is an API endpoint
        if (!urlObj.pathname.includes('/api/')) {
            showError('URL must be a Zendesk API endpoint');
            return;
        }
        
        // Validate search query parameter exists
        if (!urlObj.searchParams.has('query')) {
            showError('URL must include a search query parameter');
            return;
        }
    } catch (error) {
        showError('Please enter a valid URL');
        return;
    }

    try {
        const { endpoints = [] } = await chrome.storage.local.get(['endpoints']);

        // Check for duplicate endpoints
        const duplicate = endpoints.some(endpoint => 
            endpoint.url.toLowerCase() === url.toLowerCase() || 
            endpoint.name.toLowerCase() === name.toLowerCase()
        );
        
        if (duplicate) {
            showError('Endpoint with this name or URL already exists');
            return;
        }

        const newEndpoint = {
            id: Date.now(),
            name: name,
            url: url,
            enabled: true,
            createdAt: Date.now()
        };

        endpoints.push(newEndpoint);
        const saved = await saveEndpoints(endpoints);
        if (saved) {
            hideAddEndpointModal();
            await loadEndpoints();
            showSuccess('Endpoint added successfully');
        }

    } catch (error) {
        console.error('Error saving endpoint:', error);
        showError('Failed to save endpoint');
    }
}

// Test endpoint connection
async function testEndpoint(url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        
        // Get authentication cookies
        const cookies = await chrome.cookies.getAll({
            domain: domain
        });
        
        const cookieString = cookies
            .filter(cookie => 
                cookie.name.includes('session') || 
                cookie.name.includes('auth') || 
                cookie.name.includes('_zendesk') ||
                cookie.name.includes('csrf') ||
                cookie.name === '_help_center_session'
            )
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ');

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Cookie': cookieString
            },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.count !== undefined) {
            throw new Error('Invalid API response format');
        }

        return {
            success: true,
            count: data.count,
            message: `Success: Found ${data.count} tickets`
        };
    } catch (error) {
        console.error('Endpoint test error:', error);
        return {
            success: false,
            message: error.message || 'Failed to connect to endpoint'
        };
    }
}

// Update last check time display
function updateLastCheckTime() {
    const lastCheckElement = document.getElementById('lastCheck');
    const now = new Date();
    lastCheckElement.textContent = `Last check: ${now.toLocaleTimeString()}`;
}

// Utility functions
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

async function saveEndpoints(endpoints) {
    try {
        await chrome.storage.local.set({ endpoints });
        console.log('Endpoints saved successfully:', endpoints.length, 'endpoints');
        return true;
    } catch (error) {
        console.error('Failed to save endpoints:', error);
        showError('Failed to save endpoints. Please try again.');
        return false;
    }
}

function showError(message) {
    showMessage(message, 'error');
}

function showSuccess(message) {
    showMessage(message, 'success');
}

function showMessage(message, type) {
    // Remove existing messages
    const existing = document.querySelector('.error, .success');
    if (existing) {
        existing.remove();
    }

    // Create new message
    const div = document.createElement('div');
    div.className = type;
    div.textContent = message;

    // Insert at top of first section
    const firstSection = document.querySelector('.section');
    firstSection.insertBefore(div, firstSection.firstChild);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (div.parentNode) {
            div.remove();
        }
    }, 3000);
}

console.log('Popup script loaded');
