/**
 * Time and Date Utilities
 * All server time calculations in IST timezone
 */

/**
 * Convert any date to IST timezone
 * @param {Date|string} date - Date to convert
 * @returns {Date} - Date object in IST timezone
 */
export const toIST = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
};

/**
 * Get current server time in IST
 * @returns {Date} - Current IST time
 */
export const getCurrentISTTime = () => {
    return toIST(new Date());
};

/**
 * Format date to YYYY-MM-DD string
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export const formatDateToYYYYMMDD = (date) => {
    const d = toIST(date);
    return d.toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD format
};

/**
 * Get today's date in YYYY-MM-DD format (IST)
 * @returns {string} - Today's date
 */
export const getTodayDateString = () => {
    return formatDateToYYYYMMDD(new Date());
};

/**
 * Format date to YYYY-MM format for monthly operations
 * @param {Date} date - Date to format
 * @returns {string} - Formatted month string
 */
export const formatDateToYYYYMM = (date) => {
    const d = toIST(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

/**
 * Get current month in YYYY-MM format
 * @returns {string} - Current month
 */
export const getCurrentMonthString = () => {
    return formatDateToYYYYMM(new Date());
};

/**
 * Check if date is a Sunday
 * @param {string|Date} date - Date to check
 * @returns {boolean} - True if Sunday
 */
export const isSunday = (date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toIST(d).getDay() === 0;
};

/**
 * Get day name from date
 * @param {string|Date} date - Date to check
 * @returns {string} - Day name (Mon, Tue, etc.)
 */
export const getDayName = (date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toIST(d).toLocaleDateString('en-US', { weekday: 'short' });
};

/**
 * Get month name from date
 * @param {string|Date} date - Date to check
 * @returns {string} - Month name (January, February, etc.)
 */
export const getMonthName = (date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toIST(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/**
 * Get total days in a month
 * @param {string} month - Month in YYYY-MM format
 * @returns {number} - Number of days
 */
export const getDaysInMonth = (month) => {
    const [year, monthNum] = month.split('-').map(Number);
    return new Date(year, monthNum, 0).getDate();
};

/**
 * Get all dates in a month as YYYY-MM-DD strings
 * @param {string} month - Month in YYYY-MM format
 * @returns {string[]} - Array of date strings
 */
export const getAllDatesInMonth = (month) => {
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = getDaysInMonth(month);
    const dates = [];

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthNum - 1, day);
        dates.push(formatDateToYYYYMMDD(date));
    }

    return dates;
};

/**
 * Calculate work hours between two timestamps
 * @param {string} checkIn - ISO8601 timestamp
 * @param {string} checkOut - ISO8601 timestamp
 * @returns {number} - Hours worked (rounded to 2 decimals)
 */
export const calculateWorkHours = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return 0;

    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end - start;
    const hours = diffMs / (1000 * 60 * 60);

    return Math.round(hours * 100) / 100;
};

/**
 * Check if current time is within check-in window (00:00 - 09:05 AM IST)
 * @returns {boolean} - True if check-in is allowed
 */
export const isCheckInAllowed = () => {
    const now = getCurrentISTTime();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Before 9:05 AM
    return hour < 9 || (hour === 9 && minute <= 5);
};

/**
 * Check if current time is within check-out blocked window (4:00 PM - 5:25 PM IST)
 * @returns {boolean} - True if check-out is blocked
 */
export const isCheckOutBlocked = () => {
    const now = getCurrentISTTime();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Between 4:00 PM (16:00) and 5:25 PM (17:25)
    if (hour === 16) return true; // Entire 4:00 PM hour
    if (hour === 17 && minute <= 25) return true; // Until 5:25 PM

    return false;
};

/**
 * Parse YYYY-MM-DD date string to Date object
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {Date} - Date object
 */
export const parseDateString = (dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
};

/**
 * Check if a date is before another date (date only, ignores time)
 * @param {string} date1 - YYYY-MM-DD
 * @param {string} date2 - YYYY-MM-DD
 * @returns {boolean} - True if date1 is before date2
 */
export const isDateBefore = (date1, date2) => {
    const d1 = parseDateString(date1);
    const d2 = parseDateString(date2);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    return d1 < d2;
};

/**
 * Check if a date is after another date (date only, ignores time)
 * @param {string} date1 - YYYY-MM-DD
 * @param {string} date2 - YYYY-MM-DD
 * @returns {boolean} - True if date1 is after date2
 */
export const isDateAfter = (date1, date2) => {
    const d1 = parseDateString(date1);
    const d2 = parseDateString(date2);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    return d1 > d2;
};

/**
 * Check if two dates are the same (date only, ignores time)
 * @param {string} date1 - YYYY-MM-DD
 * @param {string} date2 - YYYY-MM-DD
 * @returns {boolean} - True if dates are equal
 */
export const isSameDate = (date1, date2) => {
    return date1 === date2;
};

/**
 * Format ISO timestamp to readable format
 * @param {string} isoTimestamp - ISO8601 timestamp
 * @param {boolean} includeSeconds - Include seconds in output
 * @returns {string} - Formatted time (e.g., "09:00 AM" or "09:00:30 AM")
 */
export const formatTimestamp = (isoTimestamp, includeSeconds = false) => {
    if (!isoTimestamp) return '';

    const date = toIST(new Date(isoTimestamp));
    const options = {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };

    if (includeSeconds) {
        options.second = '2-digit';
    }

    return date.toLocaleString('en-US', options);
};

/**
 * Get checkout time category for attendance calculation
 * @param {string} checkOutTime - ISO8601 timestamp
 * @returns {string} - 'absent' | 'half_day' | 'full_day'
 */
export const getCheckoutTimeCategory = (checkOutTime) => {
    if (!checkOutTime) return 'absent';

    const checkOut = toIST(new Date(checkOutTime));
    const hour = checkOut.getHours();
    const minute = checkOut.getMinutes();

    // Before 12:00 PM → Absent
    if (hour < 12) {
        return 'absent';
    }

    // 12:00 PM - 3:59 PM → Half Day
    if (hour < 16) {
        return 'half_day';
    }

    // 4:00 PM or later → Full Day
    return 'full_day';
};

/**
 * Count Sundays in a month
 * @param {string} month - Month in YYYY-MM format
 * @returns {number} - Number of Sundays
 */
export const countSundaysInMonth = (month) => {
    const dates = getAllDatesInMonth(month);
    return dates.filter(date => isSunday(date)).length;
};
