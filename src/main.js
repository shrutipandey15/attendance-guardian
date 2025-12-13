import { Client, Databases, Users } from 'node-appwrite';

// This function runs every time someone tries to "Check In"
export default async ({ req, res, log, error }) => {
  
  // 1. Initialize the Admin Client (The "God Mode" connection)
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY); // The Secret Key you saved in Settings

  const databases = new Databases(client);
  const users = new Users(client);

  // 2. Parse the Incoming Request
  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch (err) {
    return res.json({ success: false, message: "Invalid JSON body" }, 400);
  }

  log("Guardian has been summoned!");
  log("Checking User ID: " + payload.userId);

  // 3. Simple Response
  return res.json({
    success: true,
    message: "The Guardian is watching.",
    receivedData: payload
  });
};