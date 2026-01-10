/**
 * Location and Geofencing Utilities
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} - Distance in meters
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
};

/**
 * Check if a point is within geofence radius
 * @param {object} point - { latitude, longitude }
 * @param {object} center - { latitude, longitude, radiusMeters }
 * @returns {boolean} - True if within radius
 */
export const isWithinGeofence = (point, center) => {
    const distance = calculateDistance(
        point.latitude,
        point.longitude,
        center.latitude,
        center.longitude
    );

    return distance <= center.radiusMeters;
};

/**
 * Validate location against all office locations
 * @param {object} location - { latitude, longitude, accuracy }
 * @param {Array} officeLocations - Array of office location objects
 * @returns {object} - { isValid: boolean, matchedLocation: object|null, distance: number|null }
 */
export const validateLocationAgainstOffices = (location, officeLocations) => {
    if (!location || !location.latitude || !location.longitude) {
        return {
            isValid: false,
            matchedLocation: null,
            distance: null,
            reason: 'Location data unavailable'
        };
    }

    if (!officeLocations || officeLocations.length === 0) {
        // If no office locations configured, allow check-in but flag it
        return {
            isValid: false,
            matchedLocation: null,
            distance: null,
            reason: 'No office locations configured'
        };
    }

    // Check only active office locations
    const activeLocations = officeLocations.filter(loc => loc.isActive);

    if (activeLocations.length === 0) {
        return {
            isValid: false,
            matchedLocation: null,
            distance: null,
            reason: 'No active office locations'
        };
    }

    // Find the nearest office location
    let nearestLocation = null;
    let minDistance = Infinity;

    for (const office of activeLocations) {
        const distance = calculateDistance(
            location.latitude,
            location.longitude,
            office.latitude,
            office.longitude
        );

        if (distance < minDistance) {
            minDistance = distance;
            nearestLocation = office;
        }
    }

    // Check if within any geofence
    const isValid = minDistance <= nearestLocation.radiusMeters;

    return {
        isValid,
        matchedLocation: isValid ? nearestLocation : null,
        distance: Math.round(minDistance),
        reason: isValid ? 'Within office geofence' : `Outside geofence by ${Math.round(minDistance - nearestLocation.radiusMeters)}m`
    };
};

/**
 * Check if location accuracy is acceptable
 * @param {number} accuracy - Accuracy in meters
 * @param {number} maxAccuracy - Maximum acceptable accuracy (default: 50m)
 * @returns {boolean} - True if accuracy is acceptable
 */
export const isLocationAccuracyAcceptable = (accuracy, maxAccuracy = 50) => {
    if (accuracy === undefined || accuracy === null) return false;
    return accuracy <= maxAccuracy;
};

/**
 * Format location for display
 * @param {object} location - { latitude, longitude, accuracy }
 * @returns {string} - Formatted location string
 */
export const formatLocation = (location) => {
    if (!location || !location.latitude || !location.longitude) {
        return 'Location unavailable';
    }

    const lat = location.latitude.toFixed(6);
    const lng = location.longitude.toFixed(6);
    const acc = location.accuracy ? ` (±${Math.round(location.accuracy)}m)` : '';

    return `${lat}, ${lng}${acc}`;
};

/**
 * Parse location from JSON string
 * @param {string} locationJson - JSON string of location
 * @returns {object|null} - Parsed location object or null
 */
export const parseLocation = (locationJson) => {
    try {
        if (!locationJson) return null;
        if (typeof locationJson === 'object') return locationJson;

        const parsed = JSON.parse(locationJson);
        if (parsed.latitude && parsed.longitude) {
            return parsed;
        }
        return null;
    } catch (error) {
        return null;
    }
};
