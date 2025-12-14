import { Client, Databases, Query } from 'node-appwrite';
import forge from 'node-forge';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  const DB_ID = '693d2c7a002d224e1d81';

  try {
    const payload = JSON.parse(req.body);
    const { userId, signature, dataToVerify } = payload;

    if (!userId || !signature || !dataToVerify) {
      return res.json({ success: false, message: "❌ Missing ID or Signature" });
    }

    log(`🔒 Verifying check-in for User: ${userId}`);

    const employeeDocs = await databases.listDocuments(
      DB_ID,
      'employees',
      [Query.equal('email', payload.email)]
    );

    if (employeeDocs.total === 0) {
      return res.json({ success: false, message: "❌ User not found" });
    }

    const userProfile = employeeDocs.documents[0];
    const storedPublicKeyPem = userProfile.devicePublicKey;

    if (!storedPublicKeyPem) {
      return res.json({ success: false, message: "❌ Device not registered" });
    }

    const publicKey = forge.pki.publicKeyFromPem(storedPublicKeyPem);
    const md = forge.md.sha256.create();
    md.update(dataToVerify, 'utf8');
    const signatureBytes = forge.util.decode64(signature);
    const isVerified = publicKey.verify(md.digest().bytes(), signatureBytes);

    if (isVerified) {
      log("✅ Signature Valid!");
      const timestamp = new Date().toISOString();
      const auditPayload = JSON.stringify({
         signatureVerified: true,
         signedData: dataToVerify,
         device: req.headers['user-agent']
      });
      const hashMd = forge.md.sha256.create();
      hashMd.update(auditPayload);
      const currentHash = hashMd.digest().toHex();

      await databases.createDocument(
        DB_ID,
        'audit',
        'unique()',
        {
          actorId: userProfile.$id, 
          action: "check-in",           
          payload: auditPayload,
          hash: currentHash,            
          timestamp: timestamp,          
          employeeName: userProfile.name,
          status: 'verified',          
          deviceFingerprint: req.headers['user-agent'] || 'unknown'
        }
      );

      return res.json({ 
        success: true, 
        message: "✅ Attendance Verified & Recorded!" 
      });

    } else {
      error("⛔ Signature Invalid! Possible Hacker.");
      return res.json({ success: false, message: "⛔ Security Alert: Invalid Signature" });
    }

  } catch (err) {
    error("Server Error: " + err.message);
    return res.json({ success: false, message: "Server Error: " + err.message });
  }
};