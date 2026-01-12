import { Client, Databases, Users, Teams, Query, ID } from 'node-appwrite';
import forge from 'node-forge';

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const CHECK_IN_CUTOFF_HOUR = 9;
const CHECK_IN_CUTOFF_MINUTE = 5;
const CHECKOUT_BLOCK_START_HOUR = 16; // 4:00 PM
const CHECKOUT_BLOCK_END_HOUR = 17; // 5:25 PM
const CHECKOUT_BLOCK_END_MINUTE = 25;

const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  HALF_DAY: 'half_day',
  ABSENT: 'absent',
  SUNDAY: 'sunday',
  HOLIDAY: 'holiday',
  LEAVE: 'leave'
};

const AUDIT_ACTIONS = {
  CHECK_IN: 'check-in',
  CHECK_OUT: 'check-out',
  ATTENDANCE_MODIFIED: 'attendance-modified',
  DEVICE_REGISTERED: 'device-registered',
  DEVICE_RESET: 'device-reset',
  HOLIDAY_CREATED: 'holiday-created',
  HOLIDAY_DELETED: 'holiday-deleted',
  PAYROLL_GENERATED: 'payroll-generated',
  PAYROLL_UNLOCKED: 'payroll-unlocked',
  EMPLOYEE_CREATED: 'employee-created',
  EMPLOYEE_DEACTIVATED: 'employee-deactivated'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Convert date to IST timezone
 */
const toIST = (date) => {
  return new Date(new Date(date).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
};

/**
 * Get current server time in IST
 */
const getNowIST = () => {
  return toIST(new Date());
};

/**
 * Format date to YYYY-MM-DD
 */
const formatDate = (date) => {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
};

/**
 * Format date to YYYY-MM
 */
const formatMonth = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

/**
 * Check if check-in is allowed (before 9:05 AM IST)
 */
const isCheckInAllowed = () => {
  const now = getNowIST();
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour < CHECK_IN_CUTOFF_HOUR) return true;
  if (hour === CHECK_IN_CUTOFF_HOUR && minute <= CHECK_IN_CUTOFF_MINUTE) return true;

  return false;
};

/**
 * Check if check-out is allowed (NOT between 4:00 PM - 5:25 PM IST)
 */
const isCheckOutAllowed = () => {
  const now = getNowIST();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Before 4:00 PM - allowed
  if (hour < CHECKOUT_BLOCK_START_HOUR) return true;

  // After 5:25 PM - allowed
  if (hour > CHECKOUT_BLOCK_END_HOUR) return true;
  if (hour === CHECKOUT_BLOCK_END_HOUR && minute > CHECKOUT_BLOCK_END_MINUTE) return true;

  // Between 4:00 PM and 5:25 PM - blocked
  return false;
};

/**
 * [UPDATED] Calculate attendance status based on HOURS WORKED
 * Rules:
 * - Less than 4 hours = Absent
 * - 4 to 6 hours = Half Day
 * - More than 6 hours = Present
 */
const calculateAttendanceStatus = (workHours) => {
  if (workHours === undefined || workHours === null) return ATTENDANCE_STATUS.ABSENT;

  if (workHours < 4) {
    return ATTENDANCE_STATUS.ABSENT;
  } else if (workHours < 6) {
    return ATTENDANCE_STATUS.HALF_DAY;
  } else {
    return ATTENDANCE_STATUS.PRESENT;
  }
};

/**
 * Calculate work hours between check-in and check-out
 */
const calculateWorkHours = (checkInTime, checkOutTime) => {
  if (!checkInTime || !checkOutTime) return 0;

  const checkIn = new Date(checkInTime);
  const checkOut = new Date(checkOutTime);

  const diffMs = checkOut - checkIn;
  const diffHours = diffMs / (1000 * 60 * 60);

  return Math.max(0, parseFloat(diffHours.toFixed(2)));
};

/**
 * Verify RSA signature
 */
const verifySignature = (publicKeyPem, data, signatureBase64) => {
  try {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    const md = forge.md.sha256.create();
    md.update(data, 'utf8');
    const verified = publicKey.verify(md.digest().bytes(), forge.util.decode64(signatureBase64));
    return verified;
  } catch (err) {
    return false;
  }
};

/**
 * Calculate SHA-256 hash
 */
const calculateHash = (data) => {
  const md = forge.md.sha256.create();
  md.update(JSON.stringify(data));
  return md.digest().toHex();
};

/**
 * Validate geofence - check if location is within radius of any office location
 */
const validateGeofence = (lat, lng, officeLocations, accuracy = null) => {
  // If no office locations configured, allow (with flag)
  if (!officeLocations || officeLocations.length === 0) {
    return { valid: true, flagged: true, reason: 'No office locations configured' };
  }

  // If accuracy is too low (> 50 meters), flag but allow
  if (accuracy && accuracy > 50) {
    return { valid: true, flagged: true, reason: 'GPS accuracy too low' };
  }

  // Check distance to each office location
  for (const office of officeLocations) {
    if (!office.isActive) continue;

    const distance = calculateDistance(lat, lng, office.latitude, office.longitude);

    if (distance <= office.radiusMeters) {
      return { valid: true, flagged: false, nearestOffice: office.name };
    }
  }

  // Outside all geofences - flag
  return { valid: true, flagged: true, reason: 'Outside office premises' };
};

/**
 * Calculate distance between two coordinates using Haversine formula
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth radius in meters
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
 * Check if user is admin
 */
const checkAdmin = async (callerId, teams, adminTeamId) => {
  if (!callerId) throw new Error('Missing user ID');
  if (!adminTeamId) throw new Error('Admin team not configured');

  const memberships = await teams.listMemberships(adminTeamId, [
    Query.equal('userId', callerId)
  ]);

  if (memberships.total === 0) {
    throw new Error('Unauthorized: Admin access required');
  }
};

/**
 * Create audit log entry
 */
const createAuditLog = async (databases, dbId, data) => {
  const {
    actorId,
    action,
    targetId = null,
    targetType = null,
    payload,
    deviceInfo = null,
    ipAddress = null,
    signature = null,
    signatureVerified = false
  } = data;

  const hash = calculateHash({ actorId, action, targetId, payload, timestamp: new Date().toISOString() });

  await databases.createDocument(dbId, 'audit', ID.unique(), {
    timestamp: new Date().toISOString(),
    actorId,
    action,
    targetId,
    targetType,
    payload: JSON.stringify(payload),
    deviceInfo,
    ipAddress,
    signature,
    signatureVerified,
    hash
  });
};

// ============================================
// DATABASE HELPER FUNCTIONS
// ============================================

/**
 * Get employee by ID
 */
const getEmployee = async (databases, dbId, employeeId) => {
  try {
    return await databases.getDocument(dbId, 'employees', employeeId);
  } catch (err) {
    throw new Error('Employee not found');
  }
};

/**
 * Get employee by email
 */
const getEmployeeByEmail = async (databases, dbId, email) => {
  const result = await databases.listDocuments(dbId, 'employees', [
    Query.equal('email', email),
    Query.limit(1)
  ]);

  if (result.total === 0) throw new Error('Employee not found');
  return result.documents[0];
};

/**
 * Get attendance record for specific employee and date
 */
const getAttendanceByDate = async (databases, dbId, employeeId, date) => {
  const result = await databases.listDocuments(dbId, 'attendance', [
    Query.equal('employeeId', employeeId),
    Query.equal('date', date),
    Query.limit(1)
  ]);

  return result.total > 0 ? result.documents[0] : null;
};

/**
 * Get all active office locations
 */
const getActiveOfficeLocations = async (databases, dbId) => {
  const result = await databases.listDocuments(dbId, 'office_locations', [
    Query.equal('isActive', true)
  ]);

  return result.documents;
};


// ============================================
// EMPLOYEE ACTION HANDLERS
// ============================================

/**
 * Handle check-in
 */
const handleCheckIn = async (payload, databases, dbId) => {
  // Validate time window
  if (!isCheckInAllowed()) {
    return {
      success: false,
      message: '⛔ Check-in closed! Check-in is only allowed until 9:05 AM.'
    };
  }

  const { email, signature, dataToVerify, location } = payload;

  // Validate required fields
  if (!email || !signature || !dataToVerify) {
    return { success: false, message: 'Missing required fields' };
  }

  // Get employee
  const employee = await getEmployeeByEmail(databases, dbId, email);

  // Check if device is registered
  if (!employee.devicePublicKey) {
    return { success: false, message: 'Device not registered. Please register your device first.' };
  }

  // Verify signature
  const isValidSignature = verifySignature(employee.devicePublicKey, dataToVerify, signature);
  if (!isValidSignature) {
    return { success: false, message: 'Invalid signature. Device not authorized.' };
  }

  // Check if already checked in today
  const today = formatDate(getNowIST());
  const existingAttendance = await getAttendanceByDate(databases, dbId, employee.$id, today);

  if (existingAttendance && existingAttendance.checkInTime) {
    return { success: false, message: 'You have already checked in today.' };
  }

  // Validate location
  const officeLocations = await getActiveOfficeLocations(databases, dbId);
  let locationResult = { valid: true, flagged: false };

  if (location && location.latitude && location.longitude) {
    locationResult = validateGeofence(
      location.latitude,
      location.longitude,
      officeLocations,
      location.accuracy
    );
  } else {
    locationResult = { valid: true, flagged: true, reason: 'Location not provided' };
  }

  // Create or update attendance record
  const checkInTime = new Date().toISOString();
  const attendanceData = {
    employeeId: employee.$id,
    date: today,
    status: ATTENDANCE_STATUS.ABSENT, // Will be updated on check-out
    checkInTime,
    checkInLat: location?.latitude || null,
    checkInLng: location?.longitude || null,
    checkInAccuracy: location?.accuracy || null,
    isLocationFlagged: locationResult.flagged,
    isAutoCalculated: false,
    isLocked: false,
    notes: locationResult.flagged ? locationResult.reason : ''
  };

  let attendanceDoc;
  if (existingAttendance) {
    attendanceDoc = await databases.updateDocument(dbId, 'attendance', existingAttendance.$id, attendanceData);
  } else {
    attendanceDoc = await databases.createDocument(dbId, 'attendance', ID.unique(), attendanceData);
  }

  // Create audit log
  await createAuditLog(databases, dbId, {
    actorId: employee.$id,
    action: AUDIT_ACTIONS.CHECK_IN,
    targetId: attendanceDoc.$id,
    targetType: 'attendance',
    payload: {
      employeeName: employee.name,
      date: today,
      checkInTime,
      location: location || null,
      locationVerified: !locationResult.flagged
    },
    deviceInfo: employee.deviceFingerprint,
    signature,
    signatureVerified: true
  });

  return {
    success: true,
    message: '✅ Check-in recorded successfully',
    data: {
      attendanceId: attendanceDoc.$id,
      timestamp: checkInTime,
      locationVerified: !locationResult.flagged
    }
  };
};

/**
 * Handle check-out
 */
const handleCheckOut = async (payload, databases, dbId) => {
  // Validate time window
  if (!isCheckOutAllowed()) {
    return {
      success: false,
      message: '⛔ Check-out disabled! Please try again after 5:25 PM.'
    };
  }

  const { email, signature, dataToVerify, location } = payload;

  // Validate required fields
  if (!email || !signature || !dataToVerify) {
    return { success: false, message: 'Missing required fields' };
  }

  // Get employee
  const employee = await getEmployeeByEmail(databases, dbId, email);

  // Check if device is registered
  if (!employee.devicePublicKey) {
    return { success: false, message: 'Device not registered. Please register your device first.' };
  }

  // Verify signature
  const isValidSignature = verifySignature(employee.devicePublicKey, dataToVerify, signature);
  if (!isValidSignature) {
    return { success: false, message: 'Invalid signature. Device not authorized.' };
  }

  // Check if checked in today
  const today = formatDate(getNowIST());
  const attendance = await getAttendanceByDate(databases, dbId, employee.$id, today);

  if (!attendance || !attendance.checkInTime) {
    return { success: false, message: 'No check-in found for today. Please check in first.' };
  }

  if (attendance.checkOutTime) {
    return { success: false, message: 'You have already checked out today.' };
  }

  // Record check-out
  const checkOutTime = new Date().toISOString();
  const workHours = calculateWorkHours(attendance.checkInTime, checkOutTime);
  const status = calculateAttendanceStatus(workHours);

  await databases.updateDocument(dbId, 'attendance', attendance.$id, {
    checkOutTime,
    checkOutLat: location?.latitude || null,
    checkOutLng: location?.longitude || null,
    checkOutAccuracy: location?.accuracy || null,
    workHours,
    status
  });

  // Create audit log
  await createAuditLog(databases, dbId, {
    actorId: employee.$id,
    action: AUDIT_ACTIONS.CHECK_OUT,
    targetId: attendance.$id,
    targetType: 'attendance',
    payload: {
      employeeName: employee.name,
      date: today,
      checkOutTime,
      workHours,
      status,
      location: location || null
    },
    deviceInfo: employee.deviceFingerprint,
    signature,
    signatureVerified: true
  });

  return {
    success: true,
    message: '✅ Check-out recorded successfully',
    data: {
      attendanceId: attendance.$id,
      timestamp: checkOutTime,
      status,
      workHours
    }
  };
};

/**
 * Handle device registration
 */
const handleRegisterDevice = async (payload, databases, dbId) => {
  const { email, publicKey, deviceFingerprint } = payload;

  if (!email || !publicKey) {
    return { success: false, message: 'Missing required fields' };
  }

  // Get employee
  const employee = await getEmployeeByEmail(databases, dbId, email);

  // Check if device already registered
  if (employee.devicePublicKey) {
    return { success: false, message: 'Device already registered. Contact admin to reset.' };
  }

  // Validate public key format
  try {
    forge.pki.publicKeyFromPem(publicKey);
  } catch (err) {
    return { success: false, message: 'Invalid public key format' };
  }

  // Update employee with device info
  await databases.updateDocument(dbId, 'employees', employee.$id, {
    devicePublicKey: publicKey,
    deviceFingerprint: deviceFingerprint || null,
    deviceRegisteredAt: new Date().toISOString()
  });

  // Create audit log
  await createAuditLog(databases, dbId, {
    actorId: employee.$id,
    action: AUDIT_ACTIONS.DEVICE_REGISTERED,
    targetId: employee.$id,
    targetType: 'employee',
    payload: {
      employeeName: employee.name,
      deviceFingerprint
    },
    deviceInfo: deviceFingerprint
  });

  return {
    success: true,
    message: 'Device registered successfully',
    data: {
      deviceRegisteredAt: new Date().toISOString()
    }
  };
};

/**
 * Handle get my attendance
 */
const handleGetMyAttendance = async (payload, databases, dbId, callerId) => {
  const { month } = payload;

  // Get employee
  const employee = await getEmployee(databases, dbId, callerId);

  // Determine month to fetch
  const targetDate = month ? new Date(month + '-01') : getNowIST();
  const targetMonth = formatMonth(targetDate);

  // Get all attendance for the month
  const result = await databases.listDocuments(dbId, 'attendance', [
    Query.equal('employeeId', employee.$id),
    Query.greaterThanEqual('date', targetMonth + '-01'),
    Query.lessThan('date', targetMonth + '-32'),
    Query.orderAsc('date')
  ]);

  const records = result.documents.map(doc => ({
    date: doc.date,
    day: new Date(doc.date).toLocaleDateString('en-US', { weekday: 'short' }),
    status: doc.status,
    checkInTime: doc.checkInTime,
    checkOutTime: doc.checkOutTime,
    workHours: doc.workHours || 0,
    isAdminModified: !doc.isAutoCalculated,
    isLocationFlagged: doc.isLocationFlagged,
    notes: doc.notes || ''
  }));

  // Calculate summary
  const summary = {
    presentDays: records.filter(r => r.status === ATTENDANCE_STATUS.PRESENT).length,
    halfDays: records.filter(r => r.status === ATTENDANCE_STATUS.HALF_DAY).length,
    absentDays: records.filter(r => r.status === ATTENDANCE_STATUS.ABSENT).length,
    sundayDays: records.filter(r => r.status === ATTENDANCE_STATUS.SUNDAY).length,
    holidayDays: records.filter(r => r.status === ATTENDANCE_STATUS.HOLIDAY).length,
    leaveDays: records.filter(r => r.status === ATTENDANCE_STATUS.LEAVE).length
  };

  return {
    success: true,
    data: {
      month: targetMonth,
      records,
      summary
    }
  };
};

// ============================================
// ADMIN ACTION HANDLERS
// ============================================

/**
 * Handle create employee
 */
const handleCreateEmployee = async (payload, databases, users, dbId, callerId) => {
  const { email, password, name, salary, joinDate } = payload.data || {};

  if (!email || !password || !name) {
    return { success: false, message: 'Missing required fields' };
  }

  let newUser;

  try {
    newUser = await users.create(ID.unique(), email, null, password, name);

    await databases.createDocument(dbId, 'employees', newUser.$id, {
      name,
      email,
      role: 'employee',
      salaryMonthly: parseInt(salary) || 8000,
      joinDate: joinDate || new Date().toISOString(),
      isActive: true
    });

    await createAuditLog(databases, dbId, {
      actorId: callerId,
      action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
      targetId: newUser.$id,
      targetType: 'employee',
      payload: {
        employeeName: name,
        email,
        salary: parseInt(salary) || 8000,
        createdBy: callerId
      }
    });

    return {
      success: true,
      message: 'Employee created successfully',
      data: {
        userId: newUser.$id,
        email
      }
    };

  } catch (err) {
    if (newUser) {
      try {
        await users.delete(newUser.$id);
      } catch (deleteErr) {
        console.error(`Failed to rollback user ${newUser.$id}: ${deleteErr.message}`);
      }
    }
    throw err;
  }
};

/**
 * Handle modify attendance
 */
const handleModifyAttendance = async (payload, databases, dbId, callerId) => {
  const { attendanceId, reason, modifications } = payload;

  if (!attendanceId || !reason || !modifications) {
    return { success: false, message: 'Missing required fields' };
  }

  const attendance = await databases.getDocument(dbId, 'attendance', attendanceId);

  if (attendance.isLocked) {
    return { success: false, message: 'Attendance is locked.' };
  }

  const oldStatus = attendance.status;
  const updateData = {
    ...modifications,
    isAutoCalculated: false
  };

  let newStatus = oldStatus;

  if (modifications.checkInTime || modifications.checkOutTime) {
    const inTimeStr = modifications.checkInTime || attendance.checkInTime;
    const outTimeStr = modifications.checkOutTime || attendance.checkOutTime;
    
    if (inTimeStr && outTimeStr) {
        const inDate = new Date(inTimeStr);
        const outDate = new Date(outTimeStr);
        const workHours = Math.max(0, (outDate - inDate) / (1000 * 60 * 60));
        
        updateData.workHours = parseFloat(workHours.toFixed(2));

        if (!modifications.status) {
             if (updateData.workHours >= 6) newStatus = 'present';
             else if (updateData.workHours >= 4) newStatus = 'half_day';
             else newStatus = 'absent';
             
             updateData.status = newStatus;
        } else {
            newStatus = modifications.status;
        }
    }
  } else if (modifications.status) {
      newStatus = modifications.status;
  }

  await databases.updateDocument(dbId, 'attendance', attendanceId, updateData);
  await databases.createDocument(dbId, 'attendance_modifications', ID.unique(), {
    attendanceId,
    employeeId: attendance.employeeId,
    modifiedBy: callerId,
    modifiedAt: new Date().toISOString(),
    reason,
    originalValue: JSON.stringify({ status: oldStatus }),
    newValue: JSON.stringify({ status: newStatus })
  });

  await createAuditLog(databases, dbId, {
    actorId: callerId,
    action: AUDIT_ACTIONS.ATTENDANCE_MODIFIED,
    targetId: attendanceId,
    targetType: 'attendance',
    payload: { employeeId: attendance.employeeId, reason }
  });

  if (oldStatus !== newStatus) {
      const month = attendance.date.substring(0, 7);
      
      const payrollList = await databases.listDocuments(dbId, 'payroll', [
        Query.equal('employeeId', attendance.employeeId),
        Query.equal('month', month),
        Query.limit(1)
      ]);

      if (payrollList.total > 0) {
        const payrollDoc = payrollList.documents[0];
        
        const payrollUpdate = {
            presentDays: payrollDoc.presentDays,
            halfDays: payrollDoc.halfDays,
            absentDays: payrollDoc.absentDays,
            sundayDays: payrollDoc.sundayDays,
            holidayDays: payrollDoc.holidayDays,
            leaveDays: payrollDoc.leaveDays
        };

        if (oldStatus === 'present') payrollUpdate.presentDays--;
        else if (oldStatus === 'half_day') payrollUpdate.halfDays--;
        else if (oldStatus === 'absent') payrollUpdate.absentDays--;
        else if (oldStatus === 'sunday') payrollUpdate.sundayDays--;
        else if (oldStatus === 'holiday') payrollUpdate.holidayDays--;
        else if (oldStatus === 'leave') payrollUpdate.leaveDays--;

        if (newStatus === 'present') payrollUpdate.presentDays++;
        else if (newStatus === 'half_day') payrollUpdate.halfDays++;
        else if (newStatus === 'absent') payrollUpdate.absentDays++;
        else if (newStatus === 'sunday') payrollUpdate.sundayDays++;
        else if (newStatus === 'holiday') payrollUpdate.holidayDays++;
        else if (newStatus === 'leave') payrollUpdate.leaveDays++;

        Object.keys(payrollUpdate).forEach(key => {
            if (payrollUpdate[key] < 0) payrollUpdate[key] = 0;
        });

        const paidDays = payrollUpdate.presentDays + 
                         payrollUpdate.sundayDays + 
                         payrollUpdate.holidayDays + 
                         payrollUpdate.leaveDays + 
                         (payrollUpdate.halfDays * 0.5);
                         
        payrollUpdate.netSalary = payrollDoc.dailyRate * paidDays;
        await databases.updateDocument(dbId, 'payroll', payrollDoc.$id, payrollUpdate);
      }
  }

  return { success: true, message: 'Updated successfully' };
};

/**
 * Handle reset device
 */
const handleResetDevice = async (payload, databases, dbId, callerId) => {
  const { employeeId, reason } = payload;

  if (!employeeId || !reason) {
    return { success: false, message: 'Missing required fields' };
  }

  // Get employee
  const employee = await getEmployee(databases, dbId, employeeId);

  // Reset device
  await databases.updateDocument(dbId, 'employees', employeeId, {
    devicePublicKey: null,
    deviceFingerprint: null,
    deviceRegisteredAt: null
  });

  // Create audit log
  await createAuditLog(databases, dbId, {
    actorId: callerId,
    action: AUDIT_ACTIONS.DEVICE_RESET,
    targetId: employeeId,
    targetType: 'employee',
    payload: {
      employeeName: employee.name,
      reason,
      resetBy: callerId
    }
  });

  return {
    success: true,
    message: 'Device reset successfully. Employee must re-register on next login.'
  };
};

/**
 * Handle create holiday
 */
const handleCreateHoliday = async (payload, databases, dbId, callerId) => {
  const { date, name, description } = payload;

  if (!date || !name) {
    return { success: false, message: 'Missing required fields' };
  }

  try {
    // Create holiday
    const holiday = await databases.createDocument(dbId, 'holidays', ID.unique(), {
      date,
      name,
      description: description || null
    });

    // Create audit log
    await createAuditLog(databases, dbId, {
      actorId: callerId,
      action: AUDIT_ACTIONS.HOLIDAY_CREATED,
      targetId: holiday.$id,
      targetType: 'holiday',
      payload: {
        date,
        name,
        description,
        createdBy: callerId
      }
    });

    return {
      success: true,
      message: 'Holiday created successfully',
      data: {
        holidayId: holiday.$id
      }
    };
  } catch (err) {
    if (err.message.includes('unique')) {
      return { success: false, message: 'Holiday already exists for this date' };
    }
    throw err;
  }
};

/**
 * Handle delete holiday
 */
const handleDeleteHoliday = async (payload, databases, dbId, callerId) => {
  const { holidayId } = payload;

  if (!holidayId) {
    return { success: false, message: 'Missing holiday ID' };
  }

  // Get holiday
  const holiday = await databases.getDocument(dbId, 'holidays', holidayId);

  // Delete holiday
  await databases.deleteDocument(dbId, 'holidays', holidayId);

  // Create audit log
  await createAuditLog(databases, dbId, {
    actorId: callerId,
    action: AUDIT_ACTIONS.HOLIDAY_DELETED,
    targetId: holidayId,
    targetType: 'holiday',
    payload: {
      date: holiday.date,
      name: holiday.name,
      deletedBy: callerId
    }
  });

  return {
    success: true,
    message: 'Holiday deleted successfully'
  };
};

/**
 * Handle add office location
 */
const handleAddOfficeLocation = async (payload, databases, dbId, callerId) => {
  const { name, latitude, longitude, radiusMeters } = payload;

  if (!name || latitude === undefined || longitude === undefined) {
    return { success: false, message: 'Missing required fields' };
  }

  const location = await databases.createDocument(dbId, 'office_locations', ID.unique(), {
    name,
    latitude,
    longitude,
    radiusMeters: radiusMeters || 100,
    isActive: true,
    createdBy: callerId
  });

  return {
    success: true,
    message: 'Office location added successfully',
    data: {
      locationId: location.$id
    }
  };
};

// ============================================
// PAYROLL HANDLERS
// ============================================

/**
 * Handle generate payroll
 * Uses Promise.all to save attendance records in parallel
 * Uses dependency injection compatible logic
 */
const handleGeneratePayroll = async (payload, databases, dbId, callerId) => {
  const { month } = payload;

  if (!month) {
    return { success: false, message: 'Missing month parameter (format: YYYY-MM)' };
  }

  const existingPayrollResult = await databases.listDocuments(dbId, 'payroll', [
    Query.equal('month', month),
    Query.limit(1)
  ]);

  if (existingPayrollResult.total > 0) {
    return {
      success: false,
      message: `Payroll already generated for ${month}. Unlock it first to regenerate.`
    };
  }

  const [employeesResult, holidaysResult, leavesResult] = await Promise.all([
    databases.listDocuments(dbId, 'employees', [Query.limit(100)]),
    databases.listDocuments(dbId, 'holidays', [
      Query.greaterThanEqual('date', month + '-01'),
      Query.lessThan('date', month + '-32')
    ]),
    databases.listDocuments(dbId, 'leaves', [
      Query.equal('status', 'approved'),
      Query.greaterThanEqual('date', month + '-01'),
      Query.lessThan('date', month + '-32')
    ])
  ]);

  const employees = employeesResult.documents;
  const holidays = holidaysResult.documents;
  const leaves = leavesResult.documents;
  const [year, monthNum] = month.split('-');
  const daysInMonth = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
  const now = getNowIST();
  const isCurrentMonth = (now.getMonth() + 1) === parseInt(monthNum) && now.getFullYear() === parseInt(year);
  const lastBillableDay = isCurrentMonth ? now.getDate() : daysInMonth;

  let totalPayout = 0;
  const payrollRecords = [];

  for (const employee of employees) {
    if (!employee.isActive) {
         const hasAttendance = await databases.listDocuments(dbId, 'attendance', [
             Query.equal('employeeId', employee.$id),
             Query.startsWith('date', month), 
             Query.limit(1)
         ]);
         if (hasAttendance.total === 0) continue;
    }

    let employeeJoinDate;
    if (employee.joinDate) {
      employeeJoinDate = new Date(employee.joinDate);
      if (isNaN(employeeJoinDate.getTime())) {
          console.error(`Invalid join date for ${employee.name}`);
          employeeJoinDate = new Date(month + '-01');
      }
    } else {
      employeeJoinDate = new Date(month + '-01');
    }

    const monthStartDate = new Date(month + '-01');
    const monthEndDate = new Date(parseInt(year), parseInt(monthNum), 0);
    
    if (employeeJoinDate > monthEndDate) continue;

    const firstWorkingDay = employeeJoinDate > monthStartDate ? employeeJoinDate.getDate() : 1;
    const attendanceResult = await databases.listDocuments(dbId, 'attendance', [
      Query.equal('employeeId', employee.$id),
      Query.greaterThanEqual('date', month + '-01'),
      Query.lessThan('date', month + '-32')
    ]);

    const attendanceMap = {};
    attendanceResult.documents.forEach(att => {
      attendanceMap[att.date] = att;
    });
    let presentDays = 0, halfDays = 0, absentDays = 0, sundayDays = 0, holidayDays = 0, leaveDays = 0;
    let actualWorkingDays = 0;
    
    const missingRecordsToCreate = [];

    for (let day = 1; day <= daysInMonth; day++) {
       if (day > lastBillableDay) break;

       if (day < firstWorkingDay) continue;

       actualWorkingDays++;
       const date = `${month}-${String(day).padStart(2, '0')}`;
       const dateObj = new Date(date);
       const isSundayDate = dateObj.getDay() === 0;
       
       const holidayRecord = holidays.find(h => h.date === date);
       const leaveRecord = leaves.find(l => l.employeeId === employee.$id && l.date === date);
       
       let attendance = attendanceMap[date];

       if (!attendance) {
         let status, notes;
         
         if (isSundayDate) {
             status = ATTENDANCE_STATUS.SUNDAY;
             notes = 'Auto-marked';
             sundayDays++;
         } else if (holidayRecord) {
             status = ATTENDANCE_STATUS.HOLIDAY;
             notes = holidayRecord.name;
             holidayDays++;
         } else if (leaveRecord) {
             status = ATTENDANCE_STATUS.LEAVE;
             notes = leaveRecord.type;
             leaveDays++;
         } else {
             status = ATTENDANCE_STATUS.ABSENT;
             notes = 'Auto-marked';
             absentDays++;
         }

         missingRecordsToCreate.push(
             databases.createDocument(dbId, 'attendance', ID.unique(), {
                 employeeId: employee.$id,
                 date,
                 status,
                 isAutoCalculated: true,
                 isLocked: true,
                 isLocationFlagged: false,
                 notes
             }).catch(e => console.error(`Failed to create attendance for ${date}:`, e.message))
         );
       } else {
         switch (attendance.status) {
             case ATTENDANCE_STATUS.PRESENT: presentDays++; break;
             case ATTENDANCE_STATUS.HALF_DAY: halfDays++; break;
             case ATTENDANCE_STATUS.ABSENT: absentDays++; break;
             case ATTENDANCE_STATUS.SUNDAY: sundayDays++; break;
             case ATTENDANCE_STATUS.HOLIDAY: holidayDays++; break;
             case ATTENDANCE_STATUS.LEAVE: leaveDays++; break;
         }
         
         // If existing record is not locked, lock it now
         if (!attendance.isLocked) {
             missingRecordsToCreate.push(
                 databases.updateDocument(dbId, 'attendance', attendance.$id, { isLocked: true })
             );
         }
       }
    }
    if (missingRecordsToCreate.length > 0) {
        await Promise.all(missingRecordsToCreate);
    }
    const baseSalary = employee.salaryMonthly;
    const dailyRate = baseSalary / daysInMonth;
    const paidDays = presentDays + sundayDays + holidayDays + leaveDays + (halfDays * 0.5);
    const netSalary = dailyRate * paidDays;

    const payroll = await databases.createDocument(dbId, 'payroll', ID.unique(), {
      employeeId: employee.$id,
      month,
      baseSalary,
      totalWorkingDays: actualWorkingDays,
      presentDays,
      halfDays,
      absentDays,
      sundayDays,
      holidayDays,
      leaveDays,
      dailyRate,
      netSalary,
      isLocked: true,
      generatedBy: callerId,
      generatedAt: new Date().toISOString()
    });

    totalPayout += netSalary;
    payrollRecords.push(payroll);
  }

  await createAuditLog(databases, dbId, {
    actorId: callerId,
    action: AUDIT_ACTIONS.PAYROLL_GENERATED,
    targetId: null,
    targetType: 'payroll',
    payload: { month, employeesProcessed: employees.length, totalPayout }
  });

  return {
    success: true,
    message: `Payroll generated for ${month}`,
    data: { month, employeesProcessed: employees.length, totalPayout: totalPayout.toFixed(2) }
  };
};

/**
 * Handle unlock payroll
 */
const handleUnlockPayroll = async (payload, databases, dbId, callerId) => {
  const { month, reason } = payload;

  if (!month || !reason) {
    return { success: false, message: 'Missing required fields' };
  }

  if (reason.trim().length < 10) {
    return { success: false, message: 'Reason must be at least 10 characters' };
  }

  // Get all payroll records for the month
  const payrollResult = await databases.listDocuments(dbId, 'payroll', [
    Query.equal('month', month)
  ]);

  if (payrollResult.total === 0) {
    return { success: false, message: 'No payroll found for this month' };
  }

  // Unlock all payroll records
  for (const payroll of payrollResult.documents) {
    await databases.updateDocument(dbId, 'payroll', payroll.$id, {
      isLocked: false,
      unlockedBy: callerId,
      unlockedAt: new Date().toISOString(),
      unlockReason: reason
    });

    // Unlock all attendance for this employee for this month
    const attendanceResult = await databases.listDocuments(dbId, 'attendance', [
      Query.equal('employeeId', payroll.employeeId),
      Query.greaterThanEqual('date', month + '-01'),
      Query.lessThan('date', month + '-32')
    ]);

    for (const att of attendanceResult.documents) {
      await databases.updateDocument(dbId, 'attendance', att.$id, {
        isLocked: false
      });
    }
  }

  // Create audit log
  await createAuditLog(databases, dbId, {
    actorId: callerId,
    action: AUDIT_ACTIONS.PAYROLL_UNLOCKED,
    targetId: null,
    targetType: 'payroll',
    payload: {
      month,
      reason,
      unlockedBy: callerId
    }
  });

  return {
    success: true,
    message: `Payroll unlocked for ${month}. Attendance can now be modified.`
  };
};

/**
 * Handle delete payroll (for regeneration)
 */
const handleDeletePayroll = async (payload, databases, dbId, callerId) => {
  const { month, reason } = payload;

  if (!month || !reason) {
    return { success: false, message: 'Missing required fields' };
  }

  if (reason.trim().length < 10) {
    return { success: false, message: 'Reason must be at least 10 characters' };
  }

  const payrollResult = await databases.listDocuments(dbId, 'payroll', [
    Query.equal('month', month)
  ]);

  if (payrollResult.total === 0) {
    return { success: false, message: 'No payroll found for this month' };
  }

  let deletedCount = 0;
  let deletedAttendanceCount = 0;

  for (const payroll of payrollResult.documents) {
    const attendanceResult = await databases.listDocuments(dbId, 'attendance', [
      Query.equal('employeeId', payroll.employeeId),
      Query.equal('isAutoCalculated', true),
      Query.greaterThanEqual('date', month + '-01'),
      Query.lessThan('date', month + '-32')
    ]);

    for (const att of attendanceResult.documents) {
      await databases.deleteDocument(dbId, 'attendance', att.$id);
      deletedAttendanceCount++;
    }

    await databases.deleteDocument(dbId, 'payroll', payroll.$id);
    deletedCount++;
  }

  await createAuditLog(databases, dbId, {
    actorId: callerId,
    action: 'payroll-deleted',
    targetId: null,
    targetType: 'payroll',
    payload: {
      month,
      reason,
      deletedPayrollRecords: deletedCount,
      deletedAttendanceRecords: deletedAttendanceCount
    }
  });

  return {
    success: true,
    message: `Deleted ${deletedCount} payroll records and ${deletedAttendanceCount} auto-calculated attendance records for ${month}. You can now regenerate payroll.`,
    data: {
      deletedPayrollRecords: deletedCount,
      deletedAttendanceRecords: deletedAttendanceCount
    }
  };
};

/**
 * Handle get payroll report
 */
const handleGetPayrollReport = async (payload, databases, dbId) => {
  const { month } = payload;

  const targetMonth = month || formatMonth(getNowIST());

  // Get all payroll records for the month
  const payrollResult = await databases.listDocuments(dbId, 'payroll', [
    Query.equal('month', targetMonth)
  ]);

  const reports = [];

  for (const payroll of payrollResult.documents) {
    // Get employee
    const employee = await getEmployee(databases, dbId, payroll.employeeId);

    // Get attendance breakdown
    const attendanceResult = await databases.listDocuments(dbId, 'attendance', [
      Query.equal('employeeId', payroll.employeeId),
      Query.greaterThanEqual('date', targetMonth + '-01'),
      Query.lessThan('date', targetMonth + '-32'),
      Query.orderAsc('date')
    ]);

    const dailyBreakdown = attendanceResult.documents.map(att => ({
      id: att.$id,
      date: att.date,
      day: new Date(att.date).toLocaleDateString('en-US', { weekday: 'short' }),
      status: att.status,
      checkIn: att.checkInTime ? toIST(att.checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
      checkOut: att.checkOutTime ? toIST(att.checkOutTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
      hours: att.workHours || 0,
      notes: att.notes || ''
    }));

    reports.push({
      employeeId: employee.$id,
      employeeName: employee.name,
      month: targetMonth,
      baseSalary: payroll.baseSalary.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      dailyRate: payroll.dailyRate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      totalWorkingDays: payroll.totalWorkingDays,
      presentDays: payroll.presentDays,
      halfDays: payroll.halfDays,
      absentDays: payroll.absentDays,
      sundayDays: payroll.sundayDays,
      holidayDays: payroll.holidayDays,
      leaveDays: payroll.leaveDays,
      netSalary: payroll.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      isLocked: payroll.isLocked,
      dailyBreakdown
    });
  }

  return {
    success: true,
    data: {
      reports
    }
  };
};

// ============================================
// UTILITY/SYSTEM HANDLERS
// ============================================

/**
 * Handle get system info
 */
const handleGetSystemInfo = async () => {
  const now = getNowIST();

  return {
    success: true,
    data: {
      serverTime: new Date().toISOString(),
      serverTimeIST: now.toISOString(),
      checkInAllowed: isCheckInAllowed(),
      checkOutAllowed: isCheckOutAllowed()
    }
  };
};

const handleGetEmployees = async (databases, dbId) => {
  // Fetch up to 100 employees (add pagination if you have more)
  const result = await databases.listDocuments(dbId, 'employees', [
    Query.limit(100),
    Query.orderDesc('$createdAt')
  ]);

  return {
    success: true,
    data: {
      employees: result.documents
    }
  };
};

// ============================================
// MAIN FUNCTION (Entry Point)
// ============================================

export default async ({ req, res, log, error, _mockDatabases, _mockUsers, _mockTeams }) => {
  let client;
  let databases;
  let users;
  let teams;

  const DB_ID = process.env.APPWRITE_DB_ID;
  const ADMIN_TEAM_ID = process.env.APPWRITE_ADMIN_TEAM_ID;

  if (_mockDatabases) {
      databases = _mockDatabases;
      users = _mockUsers;
      teams = _mockTeams;
  } else {
      if (!DB_ID) {
        error('Missing APPWRITE_DB_ID environment variable');
        return res.json({ success: false, message: 'Server configuration error' });
      }

      client = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
        .setKey(process.env.APPWRITE_API_KEY);

      databases = new Databases(client);
      users = new Users(client);
      teams = new Teams(client);
  }

  try {
    // Parse request payload
    const payload = JSON.parse(req.body || '{}');
    const action = payload.action;
    const callerId = req.headers['x-appwrite-user-id'];

    log(`Action: ${action}, Caller: ${callerId}`);

    // Action router
    switch (action) {
      // ============================================
      // EMPLOYEE ACTIONS (No admin check required)
      // ============================================

      case 'check-in':
        return res.json(await handleCheckIn(payload, databases, DB_ID));

      case 'check-out':
        return res.json(await handleCheckOut(payload, databases, DB_ID));

      case 'register-device':
        return res.json(await handleRegisterDevice(payload, databases, DB_ID));

      case 'get-my-attendance':
        return res.json(await handleGetMyAttendance(payload, databases, DB_ID, callerId));

      // ============================================
      // ADMIN ACTIONS (Require admin check)
      // ============================================

      case 'create-employee':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleCreateEmployee(payload, databases, users, DB_ID, callerId));

      case 'modify-attendance':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleModifyAttendance(payload, databases, DB_ID, callerId));

      case 'reset-device':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleResetDevice(payload, databases, DB_ID, callerId));

      case 'create-holiday':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleCreateHoliday(payload, databases, DB_ID, callerId));

      case 'delete-holiday':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleDeleteHoliday(payload, databases, DB_ID, callerId));

      case 'add-office-location':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleAddOfficeLocation(payload, databases, DB_ID, callerId));

      case 'get-employees':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleGetEmployees(databases, DB_ID));

      // ============================================
      // PAYROLL ACTIONS (Admin only)
      // ============================================

      case 'generate-payroll':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleGeneratePayroll(payload, databases, DB_ID, callerId));

      case 'unlock-payroll':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleUnlockPayroll(payload, databases, DB_ID, callerId));

      case 'delete-payroll':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleDeletePayroll(payload, databases, DB_ID, callerId));

      case 'get-payroll-report':
        await checkAdmin(callerId, teams, ADMIN_TEAM_ID);
        return res.json(await handleGetPayrollReport(payload, databases, DB_ID));

      // ============================================
      // UTILITY ACTIONS (Public)
      // ============================================

      case 'get-system-info':
        return res.json(await handleGetSystemInfo());

      // ============================================
      // UNKNOWN ACTION
      // ============================================

      default:
        return res.json({
          success: false,
          message: `Unknown action: ${action}`
        });
    }

  } catch (err) {
    error(`Error: ${err.message}`);
    log(`Stack trace: ${err.stack}`);

    return res.json({
      success: false,
      message: err.message || 'Server error occurred'
    });
  }
};