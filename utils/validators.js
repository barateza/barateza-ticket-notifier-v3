// Shared validation utilities for Zendesk Ticket Monitor

/**
 * Validate endpoint URL format
 * @param {string} url - URL to validate
 * @returns {object} { valid: boolean, error: string }
 */
export function validateEndpointUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const hostnameParts = hostname.split('.');

    // Validate hostname is a Zendesk subdomain
    const isValidZendeskDomain =
      hostnameParts.length >= 3 &&
      hostnameParts[hostnameParts.length - 2] === 'zendesk' &&
      hostnameParts[hostnameParts.length - 1] === 'com' &&
      hostnameParts[0].length > 0;

    if (!isValidZendeskDomain) {
      return {
        valid: false,
        error: 'URL must be a Zendesk domain (*.zendesk.com)'
      };
    }

    // Validate URL is an API endpoint
    const hasApiPath = urlObj.pathname.includes('/api/v2/search');
    if (!hasApiPath) {
      return {
        valid: false,
        error: 'URL must be a Zendesk API endpoint'
      };
    }

    // Validate search query parameter exists
    if (!urlObj.searchParams.has('query')) {
      return {
        valid: false,
        error: 'URL must include a search query parameter'
      };
    }

    return { valid: true };
  } catch (_error) {
    return { valid: false, error: 'Please enter a valid URL' };
  }
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
