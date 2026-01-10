import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mainFunction from './main.js';

// Mock database methods
const mockCreateDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockGetDocument = vi.fn();
const mockUpdateDocument = vi.fn();
const mockDeleteDocument = vi.fn();

// Mock user methods
const mockUserCreate = vi.fn();
const mockUserDelete = vi.fn();

// Mock team methods
const mockListMemberships = vi.fn();

vi.mock('node-appwrite', () => {
    return {
        Client: vi.fn(function() {
            return {
                setEndpoint: vi.fn().mockReturnThis(),
                setProject: vi.fn().mockReturnThis(),
                setKey: vi.fn().mockReturnThis(),
            };
        }),
        Databases: vi.fn(function() {
            return {
                createDocument: mockCreateDocument,
                listDocuments: mockListDocuments,
                getDocument: mockGetDocument,
                updateDocument: mockUpdateDocument,
                deleteDocument: mockDeleteDocument,
            };
        }),
        Users: vi.fn(function() {
            return {
                create: mockUserCreate,
                delete: mockUserDelete
            };
        }),
        Teams: vi.fn(function() {
            return {
                listMemberships: mockListMemberships
            };
        }),
        Query: {
            equal: vi.fn((field, value) => ({ field, value, type: 'equal' })),
            limit: vi.fn((value) => ({ value, type: 'limit' })),
            cursorAfter: vi.fn((id) => ({ id, type: 'cursorAfter' })),
            greaterThanEqual: vi.fn((field, value) => ({ field, value, type: 'greaterThanEqual' })),
            lessThan: vi.fn((field, value) => ({ field, value, type: 'lessThan' })),
            orderAsc: vi.fn((field) => ({ field, type: 'orderAsc' }))
        },
        ID: { unique: () => 'unique-id-12345' }
    };
});

vi.mock('node-forge', () => ({
    default: {
        pki: {
            publicKeyFromPem: (pem) => {
                if (!pem || pem === 'invalid') throw new Error('Invalid PEM');
                return {
                    verify: (digest, signature) => signature !== 'invalid-signature'
                };
            }
        },
        md: {
            sha256: {
                create: () => ({
                    update: vi.fn(),
                    digest: () => ({
                        bytes: () => 'digest-bytes',
                        toHex: () => 'abc123hash456'
                    })
                })
            }
        },
        util: {
            decode64: (sig) => sig
        }
    }
}));

const run = async (payload, headers = {}) => {
    const req = {
        body: JSON.stringify(payload),
        headers: {
            'x-appwrite-user-id': headers.userId || 'test-user-id',
            ...headers
        }
    };
    const res = { json: vi.fn(data => data) };
    const log = vi.fn();
    const error = vi.fn();

    process.env.APPWRITE_DB_ID = 'test-db-id';
    process.env.APPWRITE_ADMIN_TEAM_ID = 'admin-team-id';
    process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project';
    process.env.APPWRITE_API_KEY = 'test-api-key';

    const result = await mainFunction({ req, res, log, error });
    return { result, res, log, error };
};

describe('Check-In Logic', () => {

    beforeEach(() => {
        vi.clearAllMocks();

        // Default: employee with device registered
        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'emp-123',
                name: 'John Doe',
                email: 'john@example.com',
                devicePublicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
                deviceFingerprint: 'Mozilla/5.0',
                salaryMonthly: 8000,
                isActive: true
            }]
        });

        mockCreateDocument.mockResolvedValue({ $id: 'attendance-123' });
        mockUpdateDocument.mockResolvedValue({ $id: 'attendance-123' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Should ALLOW check-in at 9:00 AM IST', async () => {
        // 9:00 AM IST = 3:30 AM UTC
        vi.setSystemTime(new Date('2024-01-15T03:30:00Z'));

        const { result } = await run({
            action: 'check-in',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data',
            location: { latitude: 12.9716, longitude: 77.5946, accuracy: 10 }
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Check-in recorded successfully');
        expect(mockCreateDocument).toHaveBeenCalledWith(
            'test-db-id',
            'attendance',
            'unique-id-12345',
            expect.objectContaining({
                employeeId: 'emp-123',
                status: 'absent', // Will be updated on checkout
                checkInLat: 12.9716,
                checkInLng: 77.5946
            })
        );
    });

    it('Should ALLOW check-in at 9:05 AM IST (last minute)', async () => {
        // 9:05 AM IST = 3:35 AM UTC
        vi.setSystemTime(new Date('2024-01-15T03:35:00Z'));

        const { result } = await run({
            action: 'check-in',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(true);
    });

    it('Should BLOCK check-in at 9:06 AM IST', async () => {
        // 9:06 AM IST = 3:36 AM UTC
        vi.setSystemTime(new Date('2024-01-15T03:36:00Z'));

        const { result } = await run({
            action: 'check-in',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Check-in closed');
        expect(result.message).toContain('9:05 AM');
    });

    it('Should reject check-in with invalid signature', async () => {
        vi.setSystemTime(new Date('2024-01-15T03:30:00Z'));

        const { result } = await run({
            action: 'check-in',
            email: 'john@example.com',
            signature: 'invalid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid signature');
    });

    it('Should reject check-in if device not registered', async () => {
        vi.setSystemTime(new Date('2024-01-15T03:30:00Z'));

        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'emp-123',
                email: 'john@example.com',
                devicePublicKey: null // No device
            }]
        });

        const { result } = await run({
            action: 'check-in',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Device not registered');
    });

    it('Should reject duplicate check-in for same day', async () => {
        vi.setSystemTime(new Date('2024-01-15T03:30:00Z'));

        // Mock existing attendance
        mockListDocuments.mockImplementation((dbId, collection, queries) => {
            if (collection === 'attendance') {
                return Promise.resolve({
                    total: 1,
                    documents: [{
                        $id: 'att-existing',
                        checkInTime: '2024-01-15T03:00:00Z'
                    }]
                });
            }
            return Promise.resolve({
                total: 1,
                documents: [{
                    $id: 'emp-123',
                    email: 'john@example.com',
                    devicePublicKey: 'valid-key'
                }]
            });
        });

        const { result } = await run({
            action: 'check-in',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('already checked in');
    });
});

describe('Check-Out Logic', () => {

    beforeEach(() => {
        vi.clearAllMocks();

        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'emp-123',
                email: 'john@example.com',
                devicePublicKey: 'valid-key',
                deviceFingerprint: 'Mozilla/5.0'
            }]
        });

        mockUpdateDocument.mockResolvedValue({ $id: 'attendance-123' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Should BLOCK check-out at 4:00 PM IST', async () => {
        // 4:00 PM IST = 10:30 AM UTC
        vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Check-out disabled');
        expect(result.message).toContain('5:25 PM');
    });

    it('Should BLOCK check-out at 5:00 PM IST', async () => {
        // 5:00 PM IST = 11:30 AM UTC
        vi.setSystemTime(new Date('2024-01-15T11:30:00Z'));

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Check-out disabled');
    });

    it('Should ALLOW check-out at 5:26 PM IST', async () => {
        // 5:26 PM IST = 11:56 AM UTC
        vi.setSystemTime(new Date('2024-01-15T11:56:00Z'));

        mockListDocuments.mockImplementation((dbId, collection) => {
            if (collection === 'attendance') {
                return Promise.resolve({
                    total: 1,
                    documents: [{
                        $id: 'att-123',
                        employeeId: 'emp-123',
                        checkInTime: '2024-01-15T03:30:00Z',
                        checkOutTime: null
                    }]
                });
            }
            return Promise.resolve({
                total: 1,
                documents: [{
                    $id: 'emp-123',
                    email: 'john@example.com',
                    devicePublicKey: 'valid-key',
                    deviceFingerprint: 'Mozilla/5.0'
                }]
            });
        });

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Check-out recorded successfully');
    });

    it('Should calculate ABSENT if checkout before 12 PM', async () => {
        // 11:00 AM IST = 5:30 AM UTC
        vi.setSystemTime(new Date('2024-01-15T05:30:00Z'));

        mockListDocuments.mockImplementation((dbId, collection) => {
            if (collection === 'attendance') {
                return Promise.resolve({
                    total: 1,
                    documents: [{
                        $id: 'att-123',
                        employeeId: 'emp-123',
                        checkInTime: '2024-01-15T03:30:00Z'
                    }]
                });
            }
            return Promise.resolve({
                total: 1,
                documents: [{
                    $id: 'emp-123',
                    email: 'john@example.com',
                    devicePublicKey: 'valid-key'
                }]
            });
        });

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(true);
        expect(result.data.status).toBe('absent');
    });

    it('Should calculate HALF_DAY if checkout between 12 PM - 3:59 PM', async () => {
        // 2:00 PM IST = 8:30 AM UTC
        vi.setSystemTime(new Date('2024-01-15T08:30:00Z'));

        mockListDocuments.mockImplementation((dbId, collection) => {
            if (collection === 'attendance') {
                return Promise.resolve({
                    total: 1,
                    documents: [{
                        $id: 'att-123',
                        employeeId: 'emp-123',
                        checkInTime: '2024-01-15T03:30:00Z'
                    }]
                });
            }
            return Promise.resolve({
                total: 1,
                documents: [{
                    $id: 'emp-123',
                    email: 'john@example.com',
                    devicePublicKey: 'valid-key'
                }]
            });
        });

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(true);
        expect(result.data.status).toBe('half_day');
    });

    it('Should calculate PRESENT if checkout at 4:00 PM or later', async () => {
        // 6:00 PM IST = 12:30 PM UTC
        vi.setSystemTime(new Date('2024-01-15T12:30:00Z'));

        mockListDocuments.mockImplementation((dbId, collection) => {
            if (collection === 'attendance') {
                return Promise.resolve({
                    total: 1,
                    documents: [{
                        $id: 'att-123',
                        employeeId: 'emp-123',
                        checkInTime: '2024-01-15T03:30:00Z'
                    }]
                });
            }
            return Promise.resolve({
                total: 1,
                documents: [{
                    $id: 'emp-123',
                    email: 'john@example.com',
                    devicePublicKey: 'valid-key'
                }]
            });
        });

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(true);
        expect(result.data.status).toBe('present');
    });

    it('Should reject checkout without check-in', async () => {
        vi.setSystemTime(new Date('2024-01-15T12:30:00Z'));

        mockListDocuments.mockImplementation((dbId, collection) => {
            if (collection === 'attendance') {
                return Promise.resolve({ total: 0, documents: [] });
            }
            return Promise.resolve({
                total: 1,
                documents: [{
                    $id: 'emp-123',
                    email: 'john@example.com',
                    devicePublicKey: 'valid-key'
                }]
            });
        });

        const { result } = await run({
            action: 'check-out',
            email: 'john@example.com',
            signature: 'valid-signature',
            dataToVerify: 'test-data'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('No check-in found');
    });
});

describe('Device Registration', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Should register device successfully', async () => {
        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'emp-123',
                email: 'john@example.com',
                devicePublicKey: null // No device yet
            }]
        });

        mockUpdateDocument.mockResolvedValue({ $id: 'emp-123' });

        const { result } = await run({
            action: 'register-device',
            email: 'john@example.com',
            publicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
            deviceFingerprint: 'Mozilla/5.0'
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Device registered successfully');
        expect(mockUpdateDocument).toHaveBeenCalledWith(
            'test-db-id',
            'employees',
            'emp-123',
            expect.objectContaining({
                devicePublicKey: expect.any(String),
                deviceFingerprint: 'Mozilla/5.0'
            })
        );
    });

    it('Should reject registration if device already registered', async () => {
        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'emp-123',
                email: 'john@example.com',
                devicePublicKey: 'existing-key'
            }]
        });

        const { result } = await run({
            action: 'register-device',
            email: 'john@example.com',
            publicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('already registered');
    });

    it('Should reject invalid public key format', async () => {
        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'emp-123',
                email: 'john@example.com',
                devicePublicKey: null
            }]
        });

        const { result } = await run({
            action: 'register-device',
            email: 'john@example.com',
            publicKey: 'invalid'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid public key');
    });
});

describe('Admin Actions', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mockListMemberships.mockResolvedValue({ total: 1 }); // User is admin
    });

    it('Should create employee successfully', async () => {
        mockUserCreate.mockResolvedValue({ $id: 'new-user-123' });
        mockCreateDocument.mockResolvedValue({ $id: 'new-user-123' });

        const { result } = await run({
            action: 'create-employee',
            data: {
                email: 'newuser@example.com',
                password: 'SecurePass123!',
                name: 'New User',
                salary: 10000
            }
        }, { userId: 'admin-123' });

        expect(result.success).toBe(true);
        expect(mockUserCreate).toHaveBeenCalled();
        expect(mockCreateDocument).toHaveBeenCalledWith(
            'test-db-id',
            'employees',
            'new-user-123',
            expect.objectContaining({
                name: 'New User',
                email: 'newuser@example.com',
                salaryMonthly: 10000
            })
        );
    });

    it('Should reject non-admin from creating employee', async () => {
        mockListMemberships.mockResolvedValue({ total: 0 }); // Not admin

        const { result } = await run({
            action: 'create-employee',
            data: {
                email: 'test@example.com',
                password: 'pass',
                name: 'Test'
            }
        }, { userId: 'regular-user' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Admin access required');
    });

    it('Should modify attendance with reason', async () => {
        mockGetDocument.mockResolvedValue({
            $id: 'att-123',
            employeeId: 'emp-123',
            date: '2024-01-15',
            checkInTime: '2024-01-15T03:30:00Z',
            checkOutTime: null,
            status: 'absent',
            isLocked: false
        });

        mockUpdateDocument.mockResolvedValue({ $id: 'att-123' });
        mockCreateDocument.mockResolvedValue({ $id: 'mod-123' });

        const { result } = await run({
            action: 'modify-attendance',
            attendanceId: 'att-123',
            reason: 'Employee forgot to check out, verified manually',
            modifications: {
                checkOutTime: '2024-01-15T12:30:00Z',
                status: 'present'
            }
        }, { userId: 'admin-123' });

        expect(result.success).toBe(true);
        expect(mockCreateDocument).toHaveBeenCalledWith(
            'test-db-id',
            'attendance_modifications',
            expect.any(String),
            expect.objectContaining({
                reason: 'Employee forgot to check out, verified manually'
            })
        );
    });

    it('Should reject modification of locked attendance', async () => {
        mockGetDocument.mockResolvedValue({
            $id: 'att-123',
            isLocked: true
        });

        const { result } = await run({
            action: 'modify-attendance',
            attendanceId: 'att-123',
            reason: 'Test reason',
            modifications: { status: 'present' }
        }, { userId: 'admin-123' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('locked');
    });

    it('Should reset device', async () => {
        mockGetDocument.mockResolvedValue({
            $id: 'emp-123',
            name: 'John Doe'
        });
        mockUpdateDocument.mockResolvedValue({ $id: 'emp-123' });

        const { result } = await run({
            action: 'reset-device',
            employeeId: 'emp-123',
            reason: 'Employee lost phone'
        }, { userId: 'admin-123' });

        expect(result.success).toBe(true);
        expect(mockUpdateDocument).toHaveBeenCalledWith(
            'test-db-id',
            'employees',
            'emp-123',
            expect.objectContaining({
                devicePublicKey: null,
                deviceFingerprint: null
            })
        );
    });
});

describe('System Info', () => {

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Should return system info', async () => {
        vi.setSystemTime(new Date('2024-01-15T03:30:00Z')); // 9:00 AM IST

        const { result } = await run({ action: 'get-system-info' });

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('serverTime');
        expect(result.data).toHaveProperty('serverTimeIST');
        expect(result.data).toHaveProperty('checkInAllowed');
        expect(result.data).toHaveProperty('checkOutAllowed');
        expect(result.data.checkInAllowed).toBe(true);
    });
});

describe('Unknown Actions', () => {

    it('Should reject unknown action', async () => {
        const { result } = await run({ action: 'invalid-action' });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Unknown action');
    });
});
