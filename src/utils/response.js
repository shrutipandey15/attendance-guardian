/**
 * Response Utilities
 * Consistent API response formatting
 */

/**
 * Send success response
 * @param {object} res - Response object
 * @param {string} message - Success message
 * @param {object} data - Response data (optional)
 * @returns {object} - Response
 */
export const sendSuccess = (res, message, data = null) => {
    const response = {
        success: true,
        message
    };

    if (data !== null) {
        response.data = data;
    }

    return res.json(response);
};

/**
 * Send error response
 * @param {object} res - Response object
 * @param {string} message - Error message
 * @param {string} code - Error code (optional)
 * @returns {object} - Response
 */
export const sendError = (res, message, code = null) => {
    const response = {
        success: false,
        message
    };

    if (code) {
        response.code = code;
    }

    return res.json(response);
};

/**
 * Error codes for consistent error handling
 */
export const ERROR_CODES = {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    ADMIN_REQUIRED: 'ADMIN_REQUIRED',
    DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
    INVALID_SIGNATURE: 'INVALID_SIGNATURE',
    DUPLICATE_CHECK_IN: 'DUPLICATE_CHECK_IN',
    DUPLICATE_CHECK_OUT: 'DUPLICATE_CHECK_OUT',
    LATE_CHECK_IN: 'LATE_CHECK_IN',
    CHECKOUT_WINDOW_BLOCKED: 'CHECKOUT_WINDOW_BLOCKED',
    ATTENDANCE_LOCKED: 'ATTENDANCE_LOCKED',
    MISSING_REASON: 'MISSING_REASON',
    DUPLICATE_HOLIDAY: 'DUPLICATE_HOLIDAY',
    LOCATION_INVALID: 'LOCATION_INVALID',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_EXISTS: 'ALREADY_EXISTS',
    INVALID_ACTION: 'INVALID_ACTION',
    MISSING_CHECK_IN: 'MISSING_CHECK_IN'
};

/**
 * Common error messages
 */
export const ERROR_MESSAGES = {
    [ERROR_CODES.AUTH_REQUIRED]: 'Authentication required',
    [ERROR_CODES.ADMIN_REQUIRED]: 'Admin privileges required',
    [ERROR_CODES.DEVICE_NOT_REGISTERED]: 'Device not registered. Please register your device first.',
    [ERROR_CODES.INVALID_SIGNATURE]: 'Invalid signature. Device not authorized.',
    [ERROR_CODES.DUPLICATE_CHECK_IN]: 'You have already checked in today.',
    [ERROR_CODES.DUPLICATE_CHECK_OUT]: 'You have already checked out today.',
    [ERROR_CODES.LATE_CHECK_IN]: '⛔ Late Entry! Check-in closes at 9:05 AM.',
    [ERROR_CODES.CHECKOUT_WINDOW_BLOCKED]: '⛔ Check-out disabled from 4:00 PM to 5:25 PM. Please try again after 5:25 PM.',
    [ERROR_CODES.ATTENDANCE_LOCKED]: 'Attendance is locked. Unlock payroll first.',
    [ERROR_CODES.MISSING_REASON]: 'Reason is required for modifications.',
    [ERROR_CODES.DUPLICATE_HOLIDAY]: 'Holiday already exists for this date.',
    [ERROR_CODES.LOCATION_INVALID]: 'Location validation failed',
    [ERROR_CODES.VALIDATION_ERROR]: 'Validation failed',
    [ERROR_CODES.NOT_FOUND]: 'Resource not found',
    [ERROR_CODES.ALREADY_EXISTS]: 'Resource already exists',
    [ERROR_CODES.INVALID_ACTION]: 'Invalid action',
    [ERROR_CODES.MISSING_CHECK_IN]: 'No check-in found for today. Please check in first.'
};

/**
 * Send validation error response
 * @param {object} res - Response object
 * @param {string[]} missingFields - Array of missing field names
 * @returns {object} - Response
 */
export const sendValidationError = (res, missingFields) => {
    return sendError(
        res,
        `Validation failed. Missing fields: ${missingFields.join(', ')}`,
        ERROR_CODES.VALIDATION_ERROR
    );
};

/**
 * Log and send error
 * @param {object} res - Response object
 * @param {Error} error - Error object
 * @param {function} logFn - Logging function
 * @param {string} context - Error context
 * @returns {object} - Response
 */
export const logAndSendError = (res, error, logFn, context = '') => {
    const message = context ? `${context}: ${error.message}` : error.message;
    if (logFn) {
        logFn(message);
        logFn(error.stack);
    }

    return sendError(res, 'An error occurred. Please try again.');
};
