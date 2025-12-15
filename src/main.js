import { Client, Databases, Users, Teams, Query, ID } from 'node-appwrite';
import forge from 'node-forge';

let payrollCache = {
    data: null,
    timestamp: 0,
    TTL_MS: 300000
};

const calculatePayroll = (emp, allLogs, holidays, leaves) => {
    const today = new Date();
    const currentDayStr = today.toISOString().split("T")[0];
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    
    const records = [];
    let present = 0, absent = 0, half = 0, hol = 0, lev = 0, weekend = 0;
    
    const joinDate = new Date(emp.joinDate);
    joinDate.setHours(0, 0, 0, 0);

    const empLogs = allLogs.filter((l) => l.actorId === emp.$id);
    const empLeaves = leaves.filter((l) => l.employeeId === emp.$id);

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(today.getFullYear(), today.getMonth(), d);
        date.setHours(0, 0, 0, 0); 
        
        if (date > today) break; 

        const dateStr = date.toISOString().split("T")[0];
        const isSun = date.getDay() === 0;
        const isToday = dateStr === currentDayStr;
        
        const holiday = holidays.find((h) => h.date === dateStr);
        const leave = empLeaves.find((l) => l.date === dateStr);
        
        // Check Join Date
        if (date < joinDate) {
            records.push({
                date: dateStr,
                day: date.toLocaleDateString("en-US", { weekday: "short" }),
                status: "Pre-Employment", 
                inT: "-", outT: "-", dur: 0, notes: "N/A"
            });
            continue;
        }
              
        const logs = empLogs
            .filter((l) => l.timestamp.startsWith(dateStr))
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // Default Status
        let status = isSun ? "Weekend" : holiday ? "Holiday" : leave ? "Leave" : "Absent";
        let notes = holiday?.name || leave?.type || "";
        let dur = 0, inT = "-", outT = "-";
        
        if (logs.length > 0) {
            let firstCheckIn = null;
            let lastCheckOut = null;
            let isAutoCheckedOut = false;
            
            for (let i = 0; i < logs.length; i++) {
                const current = logs[i];
                if (current.action === 'check-in') {
                    if (!firstCheckIn) firstCheckIn = current;
                    const next = logs[i + 1];

                    // Debounce 1 hour
                    if (next && next.action === 'check-in') {
                        const diffMs = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
                        if (diffMs < 60 * 60 * 1000) continue; 
                    }

                    if (next && next.action === 'check-out') {
                        const diff = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 3600000;
                        dur += diff;
                        lastCheckOut = next;
                        i++; 
                    } else {
                        // Missing Out
                        if (isToday) {
                            outT = "In Progress";
                            notes = "Shift Active";
                        } else {
                            dur += 4; 
                            isAutoCheckedOut = true;
                            notes += " (Missed Out: Auto 4h)";
                        }
                    }
                }
            }

            if (firstCheckIn) inT = new Date(firstCheckIn.timestamp).toLocaleTimeString('en-US', { hour: "2-digit", minute: "2-digit" });
            if (lastCheckOut) outT = new Date(lastCheckOut.timestamp).toLocaleTimeString('en-US', { hour: "2-digit", minute: "2-digit" });
            else if (isAutoCheckedOut) outT = "⚠️ Auto";
            
            if (dur > 0) { 
                if (isSun || holiday) {
                    status = "Present";
                    present++;
                    notes = isSun ? "Sunday Work" : `Holiday Work`;
                } else {
                    if (dur <= 4) {
                        status = "Half-Day";
                        half++;
                    } else {
                        status = "Present";
                        present++;
                    }
                }
            } else {
                if (isToday && firstCheckIn) status = "Present"; 
                else if (status === "Weekend") { weekend++; } 
                else if (status === "Holiday") { hol++; }
                else if (status === "Leave") { lev++; }
                else {
                    status = "Absent";
                    absent++;
                }
            }
        } else { 
            if (status === "Weekend") weekend++;
            else if (status === "Holiday") hol++;
            else if (status === "Leave") lev++;
            else if (status === "Absent") absent++;
        }

        records.push({
            date: dateStr,
            day: date.toLocaleDateString("en-US", { weekday: "short" }),
            status,
            inT,
            outT,
            dur: parseFloat(dur.toFixed(1)),
            notes,
        });
    }

    const dailyRate = emp.salaryMonthly / daysInMonth;
    const totalPaidDays = present + weekend + lev + hol + (half * 0.5);
    const net = dailyRate * totalPaidDays;

    return {
        employeeId: emp.$id,
        employeeName: emp.name,
        month: today.toLocaleDateString("en-US", { month: "long" }),
        netSalary: net.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
        presentDays: present,
        weekendDays: weekend,
        absentDays: absent, 
        holidayDays: hol,
        paidLeaveDays: lev,
        halfDays: half,
        dailyBreakdown: records,
    };
};

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  const users = new Users(client);
  const teams = new Teams(client);
  
  const DB_ID = process.env.APPWRITE_DB_ID; 
  const ADMIN_TEAM_ID = process.env.APPWRITE_ADMIN_TEAM_ID; 

  if (!DB_ID) {
      error("Missing APPWRITE_DB_ID environment variable. Execution halted.");
      return res.json({ success: false, message: "Server Error: APPWRITE_DB_ID not configured." });
  }

  const checkAdmin = async (callerId) => {
    if (!callerId) throw new Error("Missing x-appwrite-user-id header");
    if (!ADMIN_TEAM_ID) throw new Error("ADMIN_TEAM_ID not configured.");
    
    const membershipCheck = await teams.listMemberships(
        ADMIN_TEAM_ID,
        [Query.equal('userId', callerId)]
    );
    if (membershipCheck.total === 0) throw new Error("User is not in Admin Team");
  };

  try {
    let payload = {};
    if (req.body) {
        try { payload = JSON.parse(req.body); } catch (e) { payload = req.body; }
    }
    const action = payload.action;
    const callerId = req.headers['x-appwrite-user-id']; 

    if (action === 'get_payroll_report') {
        await checkAdmin(callerId); 

        const now = Date.now();
        if (payrollCache.data && (now - payrollCache.timestamp < payrollCache.TTL_MS)) {
            log("Serving payroll report from cache.");
            return res.json({ success: true, reports: payrollCache.data });
        }
        
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
        
        const [empRes, logRes, holRes, leaveRes] = await Promise.all([
            databases.listDocuments(DB_ID, "employees"),
            databases.listDocuments(DB_ID, "audit", [
                Query.greaterThanEqual("timestamp", startOfMonth),
                Query.limit(5000), 
            ]),
            databases.listDocuments(DB_ID, "holidays"),
            databases.listDocuments(DB_ID, "leaves", [
                Query.equal("status", "Approved"),
            ]),
        ]);

        const allReports = empRes.documents.map(emp => 
            calculatePayroll(
                emp, 
                logRes.documents, 
                holRes.documents, 
                leaveRes.documents
            )
        );

        payrollCache.data = allReports;
        payrollCache.timestamp = now;

        return res.json({ success: true, reports: allReports });
    }

    if (action === 'create_employee') {
        await checkAdmin(callerId); 
        const { email, password, name, salary } = payload.data || {};

        if (!email || !password || !name) {
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
                    role: 'employee',                
                    salaryMonthly: parseInt(salary) || 0, 
                    joinDate: new Date().toISOString() 
                }
            );
            
            payrollCache.data = null; 

            log(`✅ Created Employee: ${name}`);
            return res.json({ success: true, userId: newUser.$id });

        } catch (err) {
            if (newUser) await users.delete(newUser.$id).catch(() => {}); 
            return res.json({ success: false, message: `DB Error: ${err.message}` });
        }
    }
    
    if (action === 'check-in' || action === 'check-out') {
        const { userId, signature, dataToVerify, email } = payload;
        
        if (!userId || !signature) return res.json({ success: false, message: "❌ Missing signature" });

        const employeeDocs = await databases.listDocuments(DB_ID, 'employees', [Query.equal('email', email)]);
        if (employeeDocs.total === 0) return res.json({ success: false, message: "❌ User not found" });
        
        const userProfile = employeeDocs.documents[0];
        
        const userAgent = userProfile.deviceFingerprint || 'Device Not Bound/Logged';
        
        if (!userProfile.devicePublicKey) return res.json({ success: false, message: "❌ Device not registered" });

        const publicKey = forge.pki.publicKeyFromPem(userProfile.devicePublicKey);
        const md = forge.md.sha256.create();
        md.update(dataToVerify, 'utf8');
        const isVerified = publicKey.verify(md.digest().bytes(), forge.util.decode64(signature));

        if (isVerified) {
             const auditDetails = JSON.stringify({
                employeeName: userProfile.name,
                role: userProfile.role || 'employee',
                device: userAgent,
                status: 'verified',
                signedData: dataToVerify
            });
            const hashMd = forge.md.sha256.create();
            hashMd.update(auditDetails);

            await databases.createDocument(DB_ID, 'audit', ID.unique(), {
                timestamp: new Date().toISOString(),
                actorId: userProfile.$id,
                action: action,
                payload: auditDetails,
                hash: hashMd.digest().toHex()
            });
            payrollCache.data = null; 
            
            return res.json({ success: true, message: `✅ Recorded: ${action}` });
        } else {
            return res.json({ success: false, message: "⛔ Invalid Signature" });
        }
    }

    return res.json({ success: false, message: "❌ Unknown Action" });

  } catch (err) {
    error("Server Error: " + err.message);
    return res.json({ success: false, message: `Server Error: ${err.message}` });
  }
};