import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mainFunction from './main.js';

const mockCreateDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockGetDocument = vi.fn();
const mockDeleteDocument = vi.fn();

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
                deleteDocument: mockDeleteDocument,
            };
        }),
        Users: vi.fn(function() { 
            return { create: vi.fn(), delete: vi.fn() }; 
        }),
        Teams: vi.fn(function() {
            return {
                listMemberships: vi.fn().mockResolvedValue({ total: 1 }) 
            };
        }),
        Query: { 
            equal: vi.fn(), 
            limit: vi.fn(), 
            cursorAfter: vi.fn(),
            greaterThanEqual: vi.fn() 
        },
        ID: { unique: () => 'unique-id' }
    };
});

vi.mock('node-forge', () => ({
    default: {
        pki: {
            publicKeyFromPem: () => ({
                verify: () => true
            })
        },
        md: {
            sha256: {
                create: () => ({
                    update: () => {},
                    digest: () => ({ bytes: () => '', toHex: () => 'hash' })
                })
            }
        },
        util: { decode64: () => '' }
    }
}));

const run = async (payload, context = {}) => {
    const req = { 
        body: JSON.stringify(payload),
        headers: { 'x-appwrite-user-id': 'test-admin-id' }
    };
    const res = { json: vi.fn(data => data) };
    const log = vi.fn();
    const error = vi.fn();

    process.env.APPWRITE_DB_ID = 'test-db';
    process.env.APPWRITE_ADMIN_TEAM_ID = 'test-team';

    const result = await mainFunction({ req, res, log, error, ...context });
    return { result, res };
};

describe('Attendance Logic', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        mockListDocuments.mockResolvedValue({
            total: 1,
            documents: [{ 
                $id: 'user1', 
                devicePublicKey: 'key', 
                deviceFingerprint: 'browser', 
                name: 'Test User' 
            }]
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Should ALLOW check-in at 9:00 AM', async () => {
        const date = new Date('2024-01-01T03:30:00Z'); 
        vi.setSystemTime(date);

        const { result } = await run({
            action: 'check-in',
            userId: 'user1',
            signature: 'valid-sig',
            dataToVerify: 'test',
            email: 'test@example.com'
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Recorded: check-in');
        expect(mockCreateDocument).toHaveBeenCalled(); 
    });


    it('Should ALLOW check-in at 9:15 AM (New Grace Period)', async () => {
        const date = new Date('2024-01-01T03:45:00Z'); 
        vi.setSystemTime(date);

        const { result } = await run({
            action: 'check-in',
            userId: 'user1',
            signature: 'valid-sig',
            dataToVerify: 'test',
            email: 'test@example.com'
        });

        expect(result.success).toBe(true);
    });

    it('Should BLOCK check-in at 9:16 AM', async () => {
        const date = new Date('2024-01-01T03:46:00Z'); 
        vi.setSystemTime(date);

        const { result } = await run({
            action: 'check-in',
            userId: 'user1',
            signature: 'valid-sig',
            dataToVerify: 'test',
            email: 'test@example.com'
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Late Entry');
    });

    it('Should ALLOW Check-OUT even if late (e.g. 6:00 PM)', async () => {
        const date = new Date('2024-01-01T12:30:00Z'); 
        vi.setSystemTime(date);

        const { result } = await run({
            action: 'check-out', 
            userId: 'user1',
            signature: 'valid-sig',
            dataToVerify: 'test',
            email: 'test@example.com'
        });

        expect(result.success).toBe(true);
    });
});