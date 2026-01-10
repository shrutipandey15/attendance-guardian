/**
 * Authentication and Authorization Utilities
 */

import { sendError, ERROR_CODES, ERROR_MESSAGES } from './response.js';

/**
 * Get user ID from request headers
 * @param {object} req - Request object
 * @returns {string|null} - User ID or null
 */
export const getUserIdFromRequest = (req) => {
    return req.headers['x-appwrite-user-id'] || null;
};

/**
 * Check if user is authenticated
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {string|null} - User ID if authenticated, null if not (and sends error response)
 */
export const requireAuth = (req, res) => {
    const userId = getUserIdFromRequest(req);

    if (!userId) {
        sendError(res, ERROR_MESSAGES[ERROR_CODES.AUTH_REQUIRED], ERROR_CODES.AUTH_REQUIRED);
        return null;
    }

    return userId;
};

/**
 * Check if user is admin
 * @param {string} userId - User ID to check
 * @param {object} teams - Appwrite Teams instance
 * @param {string} adminTeamId - Admin team ID
 * @returns {Promise<boolean>} - True if user is admin
 */
export const isAdmin = async (userId, teams, adminTeamId) => {
    try {
        const memberships = await teams.listMemberships(adminTeamId);
        return memberships.memberships.some(m => m.userId === userId);
    } catch (error) {
        console.error('Admin check error:', error);
        return false;
    }
};

/**
 * Require admin privileges
 * @param {string} userId - User ID to check
 * @param {object} teams - Appwrite Teams instance
 * @param {string} adminTeamId - Admin team ID
 * @param {object} res - Response object
 * @returns {Promise<boolean>} - True if admin, false if not (and sends error response)
 */
export const requireAdmin = async (userId, teams, adminTeamId, res) => {
    const isAdminUser = await isAdmin(userId, teams, adminTeamId);

    if (!isAdminUser) {
        sendError(res, ERROR_MESSAGES[ERROR_CODES.ADMIN_REQUIRED], ERROR_CODES.ADMIN_REQUIRED);
        return false;
    }

    return true;
};

/**
 * Get employee profile from database
 * @param {string} email - Employee email
 * @param {object} databases - Appwrite Databases instance
 * @param {string} dbId - Database ID
 * @param {object} Query - Appwrite Query class
 * @returns {Promise<object|null>} - Employee document or null
 */
export const getEmployeeByEmail = async (email, databases, dbId, Query) => {
    try {
        const result = await databases.listDocuments(dbId, 'employees', [
            Query.equal('email', email)
        ]);

        if (result.total === 0) {
            return null;
        }

        return result.documents[0];
    } catch (error) {
        console.error('Error fetching employee:', error);
        return null;
    }
};

/**
 * Get employee profile by ID
 * @param {string} employeeId - Employee ID
 * @param {object} databases - Appwrite Databases instance
 * @param {string} dbId - Database ID
 * @returns {Promise<object|null>} - Employee document or null
 */
export const getEmployeeById = async (employeeId, databases, dbId) => {
    try {
        const employee = await databases.getDocument(dbId, 'employees', employeeId);
        return employee;
    } catch (error) {
        console.error('Error fetching employee by ID:', error);
        return null;
    }
};

/**
 * Check if employee owns the resource
 * @param {string} userId - Current user ID
 * @param {string} resourceOwnerId - Resource owner ID
 * @returns {boolean} - True if user owns the resource
 */
export const isResourceOwner = (userId, resourceOwnerId) => {
    return userId === resourceOwnerId;
};

/**
 * Require resource ownership or admin
 * @param {string} userId - Current user ID
 * @param {string} resourceOwnerId - Resource owner ID
 * @param {object} teams - Appwrite Teams instance
 * @param {string} adminTeamId - Admin team ID
 * @param {object} res - Response object
 * @returns {Promise<boolean>} - True if authorized
 */
export const requireOwnershipOrAdmin = async (userId, resourceOwnerId, teams, adminTeamId, res) => {
    // Check if user owns the resource
    if (isResourceOwner(userId, resourceOwnerId)) {
        return true;
    }

    // Check if user is admin
    return await requireAdmin(userId, teams, adminTeamId, res);
};
