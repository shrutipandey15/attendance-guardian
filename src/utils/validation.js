/**
 * Validation Utilities
 */

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
export const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Validate date string format (YYYY-MM-DD)
 * @param {string} dateString - Date to validate
 * @returns {boolean} - True if valid
 */
export const isValidDateString = (dateString) => {
    if (!dateString || typeof dateString !== 'string') return false;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateString)) return false;

    // Check if it's a real date
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
};

/**
 * Validate month string format (YYYY-MM)
 * @param {string} monthString - Month to validate
 * @returns {boolean} - True if valid
 */
export const isValidMonthString = (monthString) => {
    if (!monthString || typeof monthString !== 'string') return false;
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(monthString)) return false;

    const [year, month] = monthString.split('-').map(Number);
    return month >= 1 && month <= 12 && year >= 2000 && year <= 2100;
};

/**
 * Validate ISO8601 timestamp
 * @param {string} timestamp - Timestamp to validate
 * @returns {boolean} - True if valid
 */
export const isValidISOTimestamp = (timestamp) => {
    if (!timestamp || typeof timestamp !== 'string') return false;
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.toISOString() === timestamp;
};

/**
 * Validate coordinates
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {boolean} - True if valid
 */
export const isValidCoordinates = (latitude, longitude) => {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
    return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
};

/**
 * Validate location object
 * @param {object} location - Location object
 * @returns {boolean} - True if valid
 */
export const isValidLocation = (location) => {
    if (!location || typeof location !== 'object') return false;
    const { latitude, longitude, accuracy } = location;

    if (!isValidCoordinates(latitude, longitude)) return false;
    if (accuracy !== undefined && (typeof accuracy !== 'number' || accuracy < 0)) return false;

    return true;
};

/**
 * Validate attendance status
 * @param {string} status - Status to validate
 * @returns {boolean} - True if valid
 */
export const isValidAttendanceStatus = (status) => {
    const validStatuses = ['present', 'half_day', 'absent', 'sunday', 'holiday', 'leave'];
    return validStatuses.includes(status);
};

/**
 * Validate action type
 * @param {string} action - Action to validate
 * @returns {boolean} - True if valid
 */
export const isValidAction = (action) => {
    const validActions = [
        'check-in',
        'check-out',
        'register-device',
        'get-my-attendance',
        'create-employee',
        'modify-attendance',
        'reset-device',
        'create-holiday',
        'delete-holiday',
        'generate-payroll',
        'get-payroll-report',
        'unlock-payroll',
        'add-office-location',
        'get-audit-logs',
        'get-system-info'
    ];
    return validActions.includes(action);
};

/**
 * Validate RSA public key in PEM format
 * @param {string} publicKey - Public key to validate
 * @returns {boolean} - True if valid format
 */
export const isValidPublicKey = (publicKey) => {
    if (!publicKey || typeof publicKey !== 'string') return false;
    return publicKey.includes('-----BEGIN PUBLIC KEY-----') &&
           publicKey.includes('-----END PUBLIC KEY-----');
};

/**
 * Validate base64 string
 * @param {string} str - String to validate
 * @returns {boolean} - True if valid base64
 */
export const isValidBase64 = (str) => {
    if (!str || typeof str !== 'string') return false;
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    return base64Regex.test(str);
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} - { valid: boolean, message: string }
 */
export const validatePassword = (password) => {
    if (!password || typeof password !== 'string') {
        return { valid: false, message: 'Password is required' };
    }

    if (password.length < 8) {
        return { valid: false, message: 'Password must be at least 8 characters long' };
    }

    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one uppercase letter' };
    }

    if (!/[a-z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one lowercase letter' };
    }

    if (!/[0-9]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one number' };
    }

    return { valid: true, message: 'Password is valid' };
};

/**
 * Validate salary amount
 * @param {number} salary - Salary to validate
 * @returns {boolean} - True if valid
 */
export const isValidSalary = (salary) => {
    return typeof salary === 'number' && salary > 0 && salary <= 10000000;
};

/**
 * Sanitize string input
 * @param {string} input - String to sanitize
 * @returns {string} - Sanitized string
 */
export const sanitizeString = (input) => {
    if (!input || typeof input !== 'string') return '';
    return input.trim().replace(/[<>]/g, '');
};

/**
 * Validate required fields in object
 * @param {object} obj - Object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @returns {object} - { valid: boolean, missing: string[] }
 */
export const validateRequiredFields = (obj, requiredFields) => {
    if (!obj || typeof obj !== 'object') {
        return { valid: false, missing: requiredFields };
    }

    const missing = requiredFields.filter(field => {
        return obj[field] === undefined || obj[field] === null || obj[field] === '';
    });

    return {
        valid: missing.length === 0,
        missing
    };
};

/**
 * Validate geofence radius
 * @param {number} radius - Radius in meters
 * @returns {boolean} - True if valid
 */
export const isValidGeofenceRadius = (radius) => {
    return typeof radius === 'number' && radius > 0 && radius <= 10000;
};
