/**
 * Environment-based secrets configuration
 * This module provides secrets from environment variables instead of Azure Key Vault
 */

// Debug: Log when this module is loaded
console.log('Loading secrets configuration module...');

/**
 * Retrieves a secret from environment variables
 * @param {string} secretName - The name of the secret to retrieve
 * @returns {Promise<string>} - The secret value
 */
async function getSecret(secretName) {
  // Convert Key Vault secret name format to environment variable format
  // e.g., "JWT-SECRET" becomes "JWT_SECRET"
  const envName = secretName.replace(/-/g, '_');
  
  console.log(`Looking for environment variable: ${envName}`);
  const value = process.env[envName];
  
  if (!value) {
    console.warn(`Warning: Environment variable ${envName} is not set`);
    return '';
  }
  
  console.log(`Found environment variable: ${envName} [value hidden]`);
  return value;
}

/**
 * Initializes secrets from environment variables
 * @returns {Promise<Object>} - Object containing the secrets
 */
async function initializeSecrets() {
  try {
    console.log('Initializing secrets from environment variables...');

    //console.log('Current process.env keys:', Object.keys(process.env).filter(key => 
    //  !key.includes('SECRET') && !key.includes('PASSWORD') && !key.includes('KEY')
    //));
    
    // Get secrets from environment variables
    const jwtSecret = process.env.JWT_SECRET;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // Validate that we have values for required secrets
    if (!jwtSecret) {
      console.warn('WARNING: JWT_SECRET environment variable is not set');
    } else {
      console.log('JWT_SECRET is set [value hidden]');
    }
    
    if (!adminPassword) {
      console.warn('WARNING: ADMIN_PASSWORD environment variable is not set');
    } else {
      console.log('ADMIN_PASSWORD is set [value hidden]');
    }

    return {
      JWT_SECRET: jwtSecret || '',
      ADMIN_PASSWORD: adminPassword || ''
    };
  } catch (error) {
    console.error('Error initializing secrets:', error);
    throw new Error('Failed to initialize secrets from environment variables');
  }
}

module.exports = {
  getSecret,
  initializeSecrets
}; 