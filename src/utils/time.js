/**
 * Time and Date Utilities
 * All server time calculations in IST timezone
 */

/**
 * Convert any date to IST timezone
 */
export const toIST = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
};

/**
 * Get current server time in IST
 */
export const getCurrentISTTime = () => {
    return toIST(new Date());
};

/**
 * Format date to YYYY-MM-DD string
 */
export const formatDateToYYYYMMDD = (date) => {
    const d = toIST(date);
    return d.toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD format
};

/**
 * Get today's date in YYYY-MM-DD format (IST)
 */
export const getTodayDateString = () => {
    return formatDateToYYYYMMDD(new Date());
};

/**
 * Format date to YYYY-MM format for monthly operations
 */
export const formatDateToYYYYMM = (date) => {
    const d = toIST(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

/**
 * Get current month in YYYY-MM format
 */
export const getCurrentMonthString = () => {
    return formatDateToYYYYMM(new Date());
};

/**
 * Check if date is a Sunday
 */
export const isSunday = (date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toIST(d).getDay() === 0;
};

/**
 * Get day name from date
 */
export const getDayName = (date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toIST(d).toLocaleDateString('en-US', { weekday: 'short' });
};

/**
 * Get month name from date
 */
export const getMonthName = (date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toIST(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/**
 * Get total days in a month
 */
export const getDaysInMonth = (month) => {
    const [year, monthNum] = month.split('-').map(Number);
    return new Date(year, monthNum, 0).getDate();
};

/**
 * Get all dates in a month as YYYY-MM-DD strings
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
 * Check if current time is within check-in window (always allowed - restriction removed)
 */
export const isCheckInAllowed = () => {
    return true;
};

/**
 * Check if current time is within check-out blocked window (4:00 PM - 5:25 PM IST)
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
 */
export const parseDateString = (dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
};

/**
 * Check if a date is before another date (date only, ignores time)
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
 */
export const isSameDate = (date1, date2) => {
    return date1 === date2;
};

/**
 * Format ISO timestamp to readable format
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
 * Get checkout time category based on HOURS WORKED
 * Rules:
 * - Less than 4 hours = Absent
 * - 4 to 6 hours = Half Day
 * - More than 6 hours = Present
 */
export const getCheckoutTimeCategory = (workHours) => {
    // Safety check
    if (workHours === undefined || workHours === null) return 'absent';

    // Less than 4 hours = Absent
    if (workHours < 4) {
        return 'absent';
    }
    // 4 to 6 hours = Half Day
    else if (workHours < 6) {
        return 'half_day';
    }
    // 6+ hours = Present
    else {
        return 'present';
    }
};

/**
 * Count Sundays in a month
 */
export const countSundaysInMonth = (month) => {
    const dates = getAllDatesInMonth(month);
    return dates.filter(date => isSunday(date)).length;
};