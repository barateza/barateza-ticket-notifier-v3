// Shared validation utilities for Zendesk Ticket Monitor
import {
  getProvider,
  detectProviderFromUrl
} from './providers/provider-registry.js';

export { detectProviderFromUrl };

/**
 * Validate a monitor URL against its provider's rules.
 * @param {string} url - URL to validate
 * @param {string} [provider] - provider id; auto-detected from the URL when omitted
 * @returns {object} { valid: boolean, error: string, provider?: string }
 */
export function validateMonitorUrl(url, provider) {
  const detectedProvider = provider || detectProviderFromUrl(url);

  if (!detectedProvider) {
    return {
      valid: false,
      error: 'Could not detect a provider. Use a *.zendesk.com or *.atlassian.net search URL.',
      provider: null
    };
  }

  const result = getProvider(detectedProvider).validateUrl(url);
  return { ...result, provider: detectedProvider };
}

/**
 * Normalise a monitor URL into its canonical stored form (per provider).
 * @param {string} url
 * @param {string} provider
 * @returns {string}
 */
export function normaliseMonitorUrl(url, provider) {
  return getProvider(provider).normaliseUrl(url);
}

/**
 * Validate endpoint URL format (Zendesk legacy — kept for compatibility;
 * new code should use validateMonitorUrl).
 * @param {string} url - URL to validate
 * @returns {object} { valid: boolean, error: string }
 */
export function validateEndpointUrl(url) {
  return getProvider('zendesk').validateUrl(url);
}

/**
 * Validate endpoint name
 * @param {string} name - Name to validate
 * @returns {object} { valid: boolean, error: string }
 */
export function validateEndpointName(name) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { valid: false, error: 'Endpoint name is required' };
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 50) {
    return {
      valid: false,
      error: 'Endpoint name must be less than 50 characters'
    };
  }

  return { valid: true };
}

/**
 * Check for duplicate endpoints
 * @param {Array} endpoints - Existing endpoints
 * @param {string} name - New endpoint name
 * @param {string} url - New endpoint URL
 * @returns {object} { duplicate: boolean, error: string }
 */
export function checkForDuplicates(endpoints, name, url) {
  if (!Array.isArray(endpoints)) {
    return { duplicate: false };
  }

  const normalizedName = name.toLowerCase().trim();
  const normalizedUrl = url.toLowerCase().trim();

  const duplicate = endpoints.some(endpoint =>
    endpoint.url.toLowerCase() === normalizedUrl ||
    endpoint.name.toLowerCase() === normalizedName
  );

  if (duplicate) {
    return {
      duplicate: true,
      error: 'Endpoint with this name or URL already exists'
    };
  }

  return { duplicate: false };
}

/**
 * Validate entire endpoint object
 * @param {Object} endpoint - Endpoint to validate
 * @param {Array} existingEndpoints - Existing endpoints for duplicate checking
 * @returns {object} { valid: boolean, errors: Array }
 */
export function validateEndpoint(endpoint, existingEndpoints = []) {
  const errors = [];

  const nameValidation = validateEndpointName(endpoint.name);
  if (!nameValidation.valid) {
    errors.push(nameValidation.error);
  }

  const urlValidation = validateEndpointUrl(endpoint.url);
  if (!urlValidation.valid) {
    errors.push(urlValidation.error);
  }

  const duplicateCheck = checkForDuplicates(existingEndpoints, endpoint.name, endpoint.url);
  if (duplicateCheck.duplicate) {
    errors.push(duplicateCheck.error);
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

export default {
  validateEndpointUrl,
  validateEndpointName,
  checkForDuplicates,
  validateEndpoint
};
