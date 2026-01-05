import { Client, Databases, Users, Teams, Query, ID } from 'node-appwrite';
import forge from 'node-forge';

let payrollCache = {
    data: null,
    timestamp: 0,
    TTL_MS: 300000
};

const toIST = (d) => new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

const fetchAllLogs = async (databases, dbId, collId, baseQueries) => {
    let allDocs = [];
    let lastId = null;

    while (true) {
        const currentQueries = [
            ...baseQueries,
            Query.limit(5000)
        ];
        
        if (lastId) {
            currentQueries.push(Query.cursorAfter(lastId));
        }

        const response = await databases.listDocuments(dbId, collId, currentQueries);
        allDocs.push(...response.documents);

        if (response.documents.length < 5000) break;

        lastId = response.documents[response.documents.length - 1].$id;
    }
    
    return allDocs;
};

const calculatePayroll = (emp, userLogs, holidays, leaves) => {
    const todayIST = toIST(new Date());
    const daysInMonth = new Date(todayIST.getFullYear(), todayIST.getMonth() + 1, 0).getDate();
    
    let records = [];
    let present = 0, absent = 0, half = 0, hol = 0, lev = 0, weekend = 0;

    const empLogs = userLogs
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const empLeaves = leaves.filter((l) => l.employeeId === emp.$id);
    const joinDate = new Date(emp.joinDate);
    joinDate.setHours(0,0,0,0);

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(todayIST.getFullYear(), todayIST.getMonth(), d);
        date.setHours(0, 0, 0, 0); 
        
        if (date > todayIST) break; 

        const dateStr = date.toLocaleDateString('en-CA'); 
        const isSun = date.getDay() === 0;
        const isToday = dateStr === todayIST.toLocaleDateString('en-CA');

        const holiday = holidays.find(h => h.date === dateStr);
        const leave = empLeaves.find(l => l.date === dateStr);

        if (date < joinDate) {
             records.push({
                date: dateStr,
                day: date.toLocaleDateString("en-US", { weekday: "short" }),
                status: "Pre-Employment", 
                inT: "-", outT: "-", dur: 0, notes: "N/A"
            });
             continue;
        }

        const dailyCheckIns = empLogs.filter(l => 
            toIST(l.timestamp).toLocaleDateString('en-CA') === dateStr && l.action === 'check-in'
        );

        let dur = 0, inT = "-", outT = "-"; 
        let status = isSun ? "Weekend" : holiday ? "Holiday" : leave ? "Leave" : "Absent";
        let notes = holiday?.name || leave?.type || "";

        if (dailyCheckIns.length > 0) {
            let firstIn = null, lastOut = null, autoOut = false;

            for (let checkIn of dailyCheckIns) {
                const mainIndex = empLogs.findIndex(l => l === checkIn);
                const nextLog = empLogs[mainIndex + 1];

                if (nextLog && nextLog.action === 'check-in') {
                     const diffMins = (new Date(nextLog.timestamp) - new Date(checkIn.timestamp)) / 60000;
                     if (diffMins < 60) continue; 
                }

                if (!firstIn) firstIn = checkIn;

                if (nextLog && nextLog.action === 'check-out') {
                    const diff = (new Date(nextLog.timestamp) - new Date(checkIn.timestamp)) / 3600000; 
                    
                    if (diff < 20) { 
                        dur += diff;
                        lastOut = nextLog; 
                    } else { 
                         dur += 4; autoOut = true; notes += " (Forgot Out)";
                    }
                } else {
                    if (isToday) { outT = "In Progress"; notes = "Shift Active"; }
                    else { dur += 4; autoOut = true; notes += " (Missed Out)"; }
                }
            }
            
            if (firstIn) inT = toIST(firstIn.timestamp).toLocaleTimeString('en-US', { hour: "2-digit", minute: "2-digit", hour12: true });
            if (lastOut) outT = toIST(lastOut.timestamp).toLocaleTimeString('en-US', { hour: "2-digit", minute: "2-digit", hour12: true });
            else if (autoOut) outT = "⚠️ Auto";
            
            if (dur > 0) { 
                if (isSun || holiday) { status = "Present"; present++; }
                else if (dur <= 4) { status = "Half-Day"; half++; }
                else { status = "Present"; present++; }
            } else {
                 if (isToday && firstIn) status = "Present"; 
                 else if (status === "Weekend") weekend++; 
                 else if (status === "Holiday") hol++;
                 else if (status === "Leave") lev++;
                 else { status = "Absent"; absent++; }
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
        month: todayIST.toLocaleDateString("en-US", { month: "long" }),
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
      error("Missing APPWRITE_DB_ID environment variable.");
      return res.json({ success: false, message: "Server Error: Configuration Missing" });
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
        
        const todayIST = toIST(new Date());
        const startOfMonthDate = new Date(todayIST.getFullYear(), todayIST.getMonth(), 1);
        startOfMonthDate.setDate(startOfMonthDate.getDate() - 1); 
        const startOfMonthQuery = startOfMonthDate.toISOString();
        
        const [empRes, allAuditLogs, holRes, leaveRes] = await Promise.all([
            databases.listDocuments(DB_ID, "employees"),
            fetchAllLogs(databases, DB_ID, "audit", [
                Query.greaterThanEqual("timestamp", startOfMonthQuery)
            ]),
            databases.listDocuments(DB_ID, "holidays"),
            databases.listDocuments(DB_ID, "leaves", [
                Query.equal("status", "Approved"),
            ]),
        ]);

        const logsByEmployee = {};
        allAuditLogs.forEach(log => {
            if (!logsByEmployee[log.actorId]) logsByEmployee[log.actorId] = [];
            logsByEmployee[log.actorId].push(log);
        });

        const allReports = empRes.documents.map(emp => 
            calculatePayroll(
                emp, 
                logsByEmployee[emp.$id] || [], 
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

    if (action === 'admin_manage_log') {
        await checkAdmin(callerId);
        
        const { operation, logId, data } = payload;

        if (operation === 'delete') {
            if (!logId) return res.json({ success: false, message: "Missing Log ID" });
            await databases.deleteDocument(DB_ID, 'audit', logId);
            payrollCache.data = null; 
            return res.json({ success: true, message: "✅ Log deleted" });
        }

        if (operation === 'create') {
            const { employeeId, timestamp, type } = data; 
            
            if (!employeeId || !timestamp || !type) {
                return res.json({ success: false, message: "Missing required data" });
            }

            const empDoc = await databases.getDocument(DB_ID, 'employees', employeeId);

            const auditDetails = JSON.stringify({
                employeeName: empDoc.name,
                role: empDoc.role,
                device: 'Manual Admin Entry',
                status: 'verified',
                signedData: 'Admin Override'
            });

            await databases.createDocument(DB_ID, 'audit', ID.unique(), {
                timestamp: timestamp, 
                actorId: employeeId,
                action: type,
                payload: auditDetails,
                hash: 'ADMIN_OVERRIDE'
            });

            payrollCache.data = null; 
            return res.json({ success: true, message: "✅ Manual log added" });
        }
    }
    
    if (action === 'check-in' || action === 'check-out') {
        if (action === 'check-in') {
            const nowIST = toIST(new Date());
            const currentHour = nowIST.getHours();
            const currentMinute = nowIST.getMinutes();

            if (currentHour > 9 || (currentHour === 9 && currentMinute > 15)) {
                return res.json({ 
                    success: false, 
                    message: "⛔ Late Entry! Check-in closes at 9:15 AM." 
                });
            }
        }
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