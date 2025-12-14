import { Client, Databases, Users, Query, ID } from 'node-appwrite';
import forge from 'node-forge';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  const users = new Users(client);
  const DB_ID = '693d2c7a002d224e1d81';

  try {
    let payload = {};
    if (req.body) {
        try { payload = JSON.parse(req.body); } catch (e) { payload = req.body; }
    }
    const action = payload.action;

    if (action === 'create_employee') {
        const { email, password, name, salary } = payload.data || {};

        if (!email || !password || !name || !salary) {
            return res.json({ success: false, message: "❌ Missing details" });
        }

        let newUser;
        try {
            newUser = await users.create(ID.unique(), email, null, password, name);
            
            await databases.createDocument(
                DB_ID,
                'employees',
                newUser.$id, 
                {
                    name: name,
                    email: email,
                    salaryMonthly: parseFloat(salary),
                    devicePublicKey: null,
                    deviceFingerprint: null,
                    role: 'employee'
                }
            );

            log(`✅ Created Employee: ${name}`);
            return res.json({ success: true, userId: newUser.$id });

        } catch (err) {
            if (newUser) {
                await users.delete(newUser.$id);
            }
            error("Creation Failed: " + err.message);
            return res.json({ success: false, error: err.message });
        }
    }

    if (action === 'check-in' || action === 'check-out') {
        const { userId, signature, dataToVerify, email } = payload;
        
        if (!userId || !signature) return res.json({ success: false, message: "❌ Missing signature" });

        const employeeDocs = await databases.listDocuments(DB_ID, 'employees', [Query.equal('email', email)]);
        if (employeeDocs.total === 0) return res.json({ success: false, message: "❌ User not found" });
        
        const userProfile = employeeDocs.documents[0];
        if (!userProfile.devicePublicKey) return res.json({ success: false, message: "❌ Device not registered" });

        const publicKey = forge.pki.publicKeyFromPem(userProfile.devicePublicKey);
        const md = forge.md.sha256.create();
        md.update(dataToVerify, 'utf8');
        const isVerified = publicKey.verify(md.digest().bytes(), forge.util.decode64(signature));

        if (isVerified) {
             const auditDetails = JSON.stringify({
                employeeName: userProfile.name,
                role: userProfile.role || 'employee',
                device: req.headers['user-agent'] || 'unknown',
                status: 'verified',
                signedData: dataToVerify
            });
            const hashMd = forge.md.sha256.create();
            hashMd.update(auditDetails);

            await databases.createDocument(DB_ID, 'audit', 'unique()', {
                timestamp: new Date().toISOString(),
                actorId: userProfile.$id,
                action: action,
                payload: auditDetails,
                hash: hashMd.digest().toHex()
            });
            return res.json({ success: true, message: `✅ Recorded: ${action}` });
        } else {
            return res.json({ success: false, message: "⛔ Invalid Signature" });
        }
    }

    return res.json({ success: false, message: "❌ Unknown Action" });

  } catch (err) {
    error("Server Error: " + err.message);
    return res.json({ success: false, message: "Server Error: " + err.message });
  }
};