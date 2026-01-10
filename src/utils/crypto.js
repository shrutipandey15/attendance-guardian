/**
 * Cryptographic Utilities
 * Device binding and signature verification
 */

import forge from 'node-forge';

/**
 * Verify RSA signature
 * @param {string} publicKeyPem - Public key in PEM format
 * @param {string} signatureBase64 - Base64-encoded signature
 * @param {string} dataToVerify - Original data that was signed
 * @returns {boolean} - True if signature is valid
 */
export const verifySignature = (publicKeyPem, signatureBase64, dataToVerify) => {
    try {
        if (!publicKeyPem || !signatureBase64 || !dataToVerify) {
            return false;
        }

        // Parse the public key
        const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);

        // Decode the signature
        const signature = forge.util.decode64(signatureBase64);

        // Create a SHA-256 hash of the data
        const md = forge.md.sha256.create();
        md.update(dataToVerify, 'utf8');

        // Verify the signature
        return publicKey.verify(md.digest().bytes(), signature);
    } catch (error) {
        console.error('Signature verification error:', error);
        return false;
    }
};

/**
 * Generate SHA-256 hash of data
 * @param {string} data - Data to hash
 * @returns {string} - Hex-encoded hash
 */
export const generateHash = (data) => {
    const md = forge.md.sha256.create();
    md.update(data, 'utf8');
    return md.digest().toHex();
};

/**
 * Validate device signature for attendance action
 * @param {object} params - Validation parameters
 * @param {string} params.publicKey - Employee's device public key (PEM)
 * @param {string} params.signature - Base64-encoded signature
 * @param {string} params.userId - Employee user ID
 * @param {string} params.date - Date string (YYYY-MM-DD)
 * @param {string} params.action - Action type ('check-in' or 'check-out')
 * @returns {object} - { valid: boolean, message: string }
 */
export const validateDeviceSignature = ({ publicKey, signature, userId, date, action }) => {
    if (!publicKey) {
        return {
            valid: false,
            message: 'Device not registered. Please register your device first.'
        };
    }

    if (!signature) {
        return {
            valid: false,
            message: 'Signature missing. Cannot verify device.'
        };
    }

    // Construct the expected signed data format
    const expectedData = `${userId}:${date}:${action}`;

    // Verify the signature
    const isValid = verifySignature(publicKey, signature, expectedData);

    if (!isValid) {
        return {
            valid: false,
            message: 'Invalid signature. Device not authorized.'
        };
    }

    return {
        valid: true,
        message: 'Device verified successfully'
    };
};

/**
 * Generate audit log hash for integrity
 * @param {object} logData - Log data object
 * @returns {string} - Hex-encoded hash
 */
export const generateAuditHash = (logData) => {
    const dataString = JSON.stringify(logData);
    return generateHash(dataString);
};

/**
 * Verify audit log integrity
 * @param {object} logData - Log data object
 * @param {string} storedHash - Stored hash to verify against
 * @returns {boolean} - True if hash matches
 */
export const verifyAuditHash = (logData, storedHash) => {
    const { hash, ...dataWithoutHash } = logData;
    const calculatedHash = generateAuditHash(dataWithoutHash);
    return calculatedHash === storedHash;
};
