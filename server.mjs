import http from 'node:http';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const dataRoot = path.join(root, 'data');
const dbPath = path.join(dataRoot, 'workspace.json');
const port = Number(process.env.PORT || 4173);
const clients = new Set();
const sessions = new Map();
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
let mutationQueue = Promise.resolve();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const now = new Date();
const today = now.toISOString().slice(0, 10);
const month = today.slice(0, 7);
const ago = (days) => new Date(now.getTime() - days * 86400000).toISOString();
function nextMonthKey(sourceMonth) { const [year, monthNumber] = sourceMonth.split('-').map(Number); return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7); }
const taskHistory = (status, date, by, note) => ({ id: randomUUID(), status, at: date, by, note });
function uniqueId(prefix, records) { let id; do { id = `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`; } while (records.some((item) => item.id === id)); return id; }

function seed() {
  const employees = [
    { id: 'emp-aisha', name: 'Aisha Khan', title: 'Senior engineer', initials: 'AK', payBasis: 'hourly', hourlyRate: 1250, dailyRate: 10000, monthlySalary: 186000, hoursPerDay: 8, active: true },
    { id: 'emp-ravi', name: 'Ravi Menon', title: 'Product engineer', initials: 'RM', payBasis: 'hourly', hourlyRate: 1100, dailyRate: 8800, monthlySalary: 168000, hoursPerDay: 8, active: true },
    { id: 'emp-mina', name: 'Mina Patel', title: 'Data engineer', initials: 'MP', payBasis: 'daily', hourlyRate: 1300, dailyRate: 10400, monthlySalary: 207000, hoursPerDay: 8, active: true },
    { id: 'emp-dev', name: 'Dev Shah', title: 'QA engineer', initials: 'DS', payBasis: 'hourly', hourlyRate: 980, dailyRate: 7840, monthlySalary: 154000, hoursPerDay: 8, active: true },
  ];
  const tasks = [
    { id: 'T-240', module: 'Invoice reconciliation', project: 'Meridian finance platform', title: 'Reconcile multi-currency invoices', ownerId: 'emp-aisha', status: 'Under Fix', committedDate: ago(33).slice(0, 10), completedAt: ago(21), priority: 'High', tags: ['reconciliation', 'currency'], history: [taskHistory('Assigned', ago(36), 'Leena Das', 'Committed delivery date set.'), taskHistory('In Progress', ago(35), 'Aisha Khan', 'Work started.'), taskHistory('Completed', ago(21), 'Aisha Khan', 'Submitted within the committed window.'), taskHistory('Reopened', ago(13), 'Dev Shah', 'Defect B-087 linked to the original delivery.'), taskHistory('Under Fix', ago(12), 'Leena Das', 'Corrective work assigned for review.') ] },
    { id: 'T-241', module: 'Ledger export', project: 'Meridian finance platform', title: 'Export audit-ready ledger files', ownerId: 'emp-ravi', status: 'Completed', committedDate: ago(14).slice(0, 10), completedAt: ago(9), priority: 'Medium', tags: ['export', 'ledger'], history: [taskHistory('Assigned', ago(18), 'Leena Das', 'Committed delivery date set.'), taskHistory('In Progress', ago(17), 'Ravi Menon', 'Work started.'), taskHistory('Completed', ago(9), 'Ravi Menon', 'Completed ahead of schedule.') ] },
    { id: 'T-242', module: 'Access controls', project: 'Meridian finance platform', title: 'Add scoped data permissions', ownerId: 'emp-mina', status: 'In Progress', committedDate: ago(-5).slice(0, 10), completedAt: null, priority: 'High', tags: ['permissions', 'security'], history: [taskHistory('Assigned', ago(7), 'Leena Das', 'Committed delivery date set.'), taskHistory('In Progress', ago(6), 'Mina Patel', 'Work started.') ] },
    { id: 'T-243', module: 'Reconciliation alerts', project: 'Meridian finance platform', title: 'Notify operators about unmatched records', ownerId: 'emp-dev', status: 'Closed', committedDate: ago(28).slice(0, 10), completedAt: ago(25), priority: 'Low', tags: ['alerts', 'notifications'], history: [taskHistory('Assigned', ago(30), 'Leena Das', 'Committed delivery date set.'), taskHistory('In Progress', ago(29), 'Dev Shah', 'Work started.'), taskHistory('Completed', ago(25), 'Dev Shah', 'Submitted within the committed window.'), taskHistory('Reopened', ago(22), 'Leena Das', 'B-083 reported after a client scope change.'), taskHistory('Under Fix', ago(21), 'Leena Das', 'Change reviewed as external scope.'), taskHistory('Closed', ago(19), 'Leena Das', 'Fix verified and defect closed.') ] },
    { id: 'T-244', module: 'Revenue dashboard', project: 'Meridian finance platform', title: 'Add period comparison cards', ownerId: 'emp-aisha', status: 'Assigned', committedDate: ago(-9).slice(0, 10), completedAt: null, priority: 'Medium', tags: ['dashboard', 'analytics'], history: [taskHistory('Assigned', ago(1), 'Leena Das', 'Committed delivery date set.') ] },
  ];
  const bugs = [
    { id: 'B-087', taskId: 'T-240', title: 'Rounding drift on converted invoices', description: 'A small rounding drift appears after currency conversion when multiple partial payments are reconciled.', severity: 'High', foundAt: ago(13), reportedBy: 'emp-dev', status: 'Under Fix', cause: 'original', causeReason: 'Reproduced against the committed conversion rules; reviewed against the accepted delivery.', reviewedBy: 'Maya Rao', reviewedAt: ago(12), closedAt: null, tags: ['currency', 'rounding', 'reconciliation'] },
    { id: 'B-083', taskId: 'T-243', title: 'Alert copy for a new review state', description: 'A new client review state needs an alert label that was not part of the original acceptance criteria.', severity: 'Low', foundAt: ago(22), reportedBy: 'emp-ravi', status: 'Closed', cause: 'external', causeReason: 'Client introduced a new review state after delivery; excluded from rework deduction.', reviewedBy: 'Maya Rao', reviewedAt: ago(21), closedAt: ago(19), tags: ['alerts', 'client-scope'] },
  ];
  const timeEntries = [
    { id: 'TIME-901', employeeId: 'emp-aisha', taskId: 'T-240', bugId: 'B-087', type: 'corrective', hours: 1.5, note: 'Reproduced and patched the conversion rounding issue.', date: ago(8).slice(0, 10), status: 'approved', createdAt: ago(8), reviewedBy: 'Leena Das', reviewedAt: ago(7), reviewNote: 'Matches the linked defect and fix notes.' },
    { id: 'TIME-902', employeeId: 'emp-aisha', taskId: 'T-240', bugId: 'B-087', type: 'corrective', hours: 1, note: 'Added regression coverage for partial payment sequences.', date: ago(5).slice(0, 10), status: 'pending', createdAt: ago(5), reviewedBy: null, reviewedAt: null, reviewNote: '' },
    { id: 'TIME-903', employeeId: 'emp-ravi', taskId: 'T-243', bugId: 'B-083', type: 'corrective', hours: 1, note: 'Updated the alert label to match the new client state.', date: ago(20).slice(0, 10), status: 'approved', createdAt: ago(20), reviewedBy: 'Leena Das', reviewedAt: ago(20), reviewNote: 'New scope. Kept separate from original delivery quality.' },
    { id: 'TIME-904', employeeId: 'emp-ravi', taskId: 'T-241', bugId: null, type: 'regular', hours: 3, note: 'Ledger export documentation and handover.', date: ago(2).slice(0, 10), status: 'approved', createdAt: ago(2), reviewedBy: 'Leena Das', reviewedAt: ago(2), reviewNote: 'Regular delivery work.' },
  ];
  const notices = [
    { id: randomUUID(), employeeId: 'emp-aisha', title: 'Rework hours are in review', message: '1.5 approved corrective hours for B-087 are currently estimated at ₹1,875 for next month. One additional hour is awaiting review.', at: ago(7), read: false, type: 'payroll' },
    { id: randomUUID(), employeeId: 'emp-dev', title: 'Defect linked to your delivery', message: 'B-087 was linked to the Invoice reconciliation task. The team lead recorded the quality review and assigned corrective work.', at: ago(12), read: false, type: 'task' },
  ];
  return {
    version: 1, updatedAt: now.toISOString(), employees, tasks, bugs, timeEntries, notices, audit: [
      { id: randomUUID(), at: ago(21), actor: 'Aisha Khan', role: 'employee', action: 'Task completed', detail: 'T-240 · Reconcile multi-currency invoices.' },
      { id: randomUUID(), at: ago(13), actor: 'Dev Shah', role: 'employee', action: 'Defect reported', detail: 'B-087 linked to T-240; original owner Aisha Khan.' },
      { id: randomUUID(), at: ago(12), actor: 'Maya Rao', role: 'manager', action: 'Cause confirmed', detail: 'B-087 · Original delivery · justification recorded.' },
      { id: randomUUID(), at: ago(7), actor: 'Leena Das', role: 'team-lead', action: 'Corrective hours approved', detail: '1.5 hours · B-087 · November payroll preview notified.' },
      { id: randomUUID(), at: ago(21), actor: 'Maya Rao', role: 'manager', action: 'External change confirmed', detail: 'B-083 · Client scope change · excluded from payroll deduction.' },
    ], payroll: [], accounts: []
  };
}

let db;
async function loadDb() {
  await mkdir(dataRoot, { recursive: true });
  try {
    const saved = JSON.parse(await readFile(dbPath, 'utf8'));
    if (!saved || typeof saved !== 'object' || !Number.isFinite(saved.version) || !Array.isArray(saved.employees) || !Array.isArray(saved.tasks) || !Array.isArray(saved.bugs) || !Array.isArray(saved.timeEntries) || !Array.isArray(saved.notices) || !Array.isArray(saved.audit) || !Array.isArray(saved.payroll)) {
      throw new Error('The saved workspace does not match the expected data format. Keep the file for recovery and repair it before restarting.');
    }
    db = saved;
    if (!Array.isArray(db.accounts)) { db.accounts = []; await persist(); }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = seed();
    await persist();
  }
}
async function persist() {
  db.updatedAt = new Date().toISOString();
  db.version += 1;
  const temp = `${dbPath}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(db, null, 2), 'utf8');
    await rename(temp, dbPath);
  } catch (error) {
    error.statusCode = 500;
    throw error;
  }
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function safeAccount(account) {
  if (!account) return null;
  return { id: account.id, email: account.email, name: account.name, role: account.role, employeeId: account.employeeId || null, createdAt: account.createdAt, active: account.active !== false, status: account.status || (account.active === false ? 'disabled' : 'approved') };
}
function sessionAccount(req) {
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('rl_session='))?.slice('rl_session='.length);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  const account = db.accounts.find((item) => item.id === session.accountId && item.active !== false);
  if (!account || (account.role === 'employee' && !db.employees.some((item) => item.id === account.employeeId && item.active))) { sessions.delete(token); return null; }
  return account;
}
function newSession(res, account) {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { accountId: account.id, expiresAt: Date.now() + sessionLifetimeMs });
  res.setHeader('set-cookie', `rl_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`);
}
function clearSession(req, res) {
  const token = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('rl_session='))?.slice('rl_session='.length);
  if (token) sessions.delete(token);
  res.setHeader('set-cookie', 'rl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
function passwordMatches(password, account) {
  try {
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = scryptSync(password, account.passwordSalt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
function publicWorkspace(account) {
  const result = structuredClone(db);
  delete result.accounts;
  if (account.role !== 'employee') {
    if (['team-lead', 'manager'].includes(account.role)) {
      result.employees.forEach((employee) => { delete employee.hourlyRate; delete employee.dailyRate; delete employee.monthlySalary; delete employee.payBasis; });
      result.payroll = [];
    }
    if (account.role === 'manager') {
      result.managerPayrollPreviews = managerPayrollPreviews();
    }
    return result;
  }
  const employeeId = account.employeeId;
  const taskIds = new Set(result.tasks.filter((item) => item.ownerId === employeeId).map((item) => item.id));
  const bugIds = new Set(result.bugs.filter((item) => taskIds.has(item.taskId) || item.reportedBy === employeeId).map((item) => item.id));
  result.employees = result.employees.filter((item) => item.id === employeeId);
  result.tasks = result.tasks.filter((item) => taskIds.has(item.id));
  result.bugs = result.bugs.filter((item) => bugIds.has(item.id));
  result.timeEntries = result.timeEntries.filter((item) => item.employeeId === employeeId);
  result.notices = result.notices.filter((item) => item.employeeId === employeeId);
  result.audit = [];
  result.payroll = result.payroll.map((report) => {
    const rows = report.rows.filter((row) => row.employeeId === employeeId);
    const inputRecords = (report.inputRecords || []).filter((entry) => entry.employeeId === employeeId);
    const ownDefects = (report.sourceSummary?.defectsFound || []).filter((item) => item.ownerId === employeeId);
    const ownApproved = inputRecords.filter((item) => item.status === 'approved');
    const ownEligible = ownApproved.filter((item) => item.cause === 'original');
    const ownExternal = ownApproved.filter((item) => item.cause === 'external');
    const sourceSummary = { defectsFound: ownDefects, correctiveHours: inputRecords.reduce((sum, item) => sum + Number(item.hours), 0), eligibleHours: ownEligible.reduce((sum, item) => sum + Number(item.hours), 0), excludedExternalHours: ownExternal.reduce((sum, item) => sum + Number(item.hours), 0), excludedExternalEstimate: ownExternal.reduce((sum, item) => sum + Number(item.estimatedAmount || 0), 0), payrollAdjustment: rows.reduce((sum, row) => sum + row.deduction, 0) };
    return { ...report, rows, inputRecords, sourceSummary, totalGross: rows.reduce((sum, row) => sum + row.gross, 0), totalDeduction: rows.reduce((sum, row) => sum + row.deduction, 0), totalNet: rows.reduce((sum, row) => sum + row.net, 0) };
  });
  return result;
}
function createAccountRecord(data) {
  const email = String(data.email || '').trim().toLowerCase();
  const name = String(data.name || '').trim();
  const role = String(data.role || '');
  const password = String(data.password || '');
  const employeeId = role === 'employee' ? String(data.employeeId || '') : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid work email.');
  if (!name || name.length > 80) throw new Error('Enter a name (up to 80 characters).');
  if (!['employee', 'team-lead', 'manager', 'finance', 'admin'].includes(role)) throw new Error('Choose one of the available portal roles.');
  if (password.length < 10 || password.length > 1024) throw new Error('Use a password between 10 and 1,024 characters.');
  if (db.accounts.some((item) => item.email === email)) throw new Error('An account already exists for that email.');
  if (role === 'employee') {
    const employee = db.employees.find((item) => item.id === employeeId && item.active);
    if (!employee) throw new Error('Choose an active employee profile for this employee account.');
    if (db.accounts.some((item) => item.role === 'employee' && item.employeeId === employeeId && item.active !== false)) throw new Error('That employee already has a login account.');
  }
  const credential = passwordRecord(password);
  const account = { id: randomUUID(), email, name, role, employeeId, passwordSalt: credential.salt, passwordHash: credential.hash, createdAt: new Date().toISOString(), active: true, status: 'approved' };
  db.accounts.push(account);
  audit(name, role, 'Portal account created', `${email} · ${role}`);
  return account;
}
function createAccountRequest(data) {
  const email = String(data.email || '').trim().toLowerCase();
  const name = String(data.name || '').trim();
  const role = String(data.role || '');
  const password = String(data.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid work email.');
  if (!name || name.length > 80) throw new Error('Enter a name (up to 80 characters).');
  if (!['employee', 'team-lead', 'manager', 'finance'].includes(role)) throw new Error('Choose an available non-administrator portal.');
  if (password.length < 10 || password.length > 1024) throw new Error('Use a password between 10 and 1,024 characters.');
  if (db.accounts.some((item) => item.email === email)) throw new Error('An account or access request already exists for that email. Contact the workspace administrator if you need help.');
  const credential = passwordRecord(password);
  const account = { id: randomUUID(), email, name, role, employeeId: null, passwordSalt: credential.salt, passwordHash: credential.hash, createdAt: new Date().toISOString(), active: false, status: 'pending' };
  db.accounts.push(account);
  audit('Account request', role, 'Portal access requested', `${email} · ${role}`);
  return account;
}
function approveAccountRequest(accountId, data, actor) {
  const account = db.accounts.find((item) => item.id === accountId && item.status === 'pending');
  if (!account) throw new Error('That pending account request no longer exists. Refresh the Accounts page.');
  if (account.role === 'employee') {
    const employeeId = String(data.employeeId || '');
    const employee = db.employees.find((item) => item.id === employeeId && item.active);
    if (!employee) throw new Error('Choose an active employee profile before approving this request.');
    if (db.accounts.some((item) => item.role === 'employee' && item.employeeId === employeeId && item.active !== false)) throw new Error('That employee already has an active login account.');
    account.employeeId = employeeId;
  }
  account.active = true;
  account.status = 'approved';
  audit(actor.name, actor.role, 'Portal account approved', `${account.email} · ${account.role}`);
  return account;
}
function audit(actor, role, action, detail) {
  db.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), actor, role, action, detail });
}
function notify(employeeId, title, message, type = 'payroll') {
  db.notices.unshift({ id: randomUUID(), employeeId, title, message, at: new Date().toISOString(), read: false, type });
}
function actorInfo(account) {
  const employee = account.role === 'employee' ? db.employees.find((item) => item.id === account.employeeId && item.active) : null;
  return { name: employee?.name || account.name, role: account.role, employee };
}
function can(role, allowed) { return allowed.includes(role); }
function findTask(id) { return db.tasks.find((item) => item.id === id); }
function findBug(id) { return db.bugs.find((item) => item.id === id); }
function findEmployee(id) { return db.employees.find((item) => item.id === id); }
function history(task, status, by, note) {
  task.status = status;
  task.history.unshift(taskHistory(status, new Date().toISOString(), by, note));
  if (status === 'Completed' && !task.completedAt) task.completedAt = new Date().toISOString();
}
function monthlyRate(employee) {
  const hoursPerDay = employee.hoursPerDay || 8;
  return employee.payBasis === 'daily' ? (employee.dailyRate || employee.hourlyRate * hoursPerDay) / hoursPerDay : (employee.hourlyRate || employee.dailyRate / hoursPerDay);
}
function correctiveAmountPaise(entry, employee) {
  const quarterHours = Math.round(Number(entry.hours) * 4);
  const hoursPerDay = Number(employee.hoursPerDay || 8);
  const sourceRate = employee.payBasis === 'daily' ? Number(employee.dailyRate || employee.hourlyRate * hoursPerDay) : Number(employee.hourlyRate || employee.dailyRate / hoursPerDay);
  const ratePaise = Math.round(sourceRate * 100);
  return Math.round(quarterHours * ratePaise / (4 * (employee.payBasis === 'daily' ? hoursPerDay : 1)));
}
function payrollFor(targetMonth) {
  const [year, mm] = targetMonth.split('-').map(Number);
  if (!year || mm < 1 || mm > 12) throw new Error('Choose a valid payroll month.');
  const prevDate = new Date(Date.UTC(year, mm - 2, 1));
  const sourceMonth = prevDate.toISOString().slice(0, 7);
  const inputRecords = db.timeEntries.filter((entry) => entry.type === 'corrective' && entry.date.startsWith(sourceMonth)).map((entry) => {
    const bug = findBug(entry.bugId); const task = findTask(entry.taskId); const employee = findEmployee(entry.employeeId);
    return { timeId: entry.id, date: entry.date, employeeId: entry.employeeId, employee: employee?.name || 'Unknown employee', taskId: entry.taskId, module: task?.module || 'Unknown module', bugId: entry.bugId, hours: entry.hours, status: entry.status, cause: bug?.cause || 'missing', causeReason: bug?.causeReason || '', reviewNote: entry.reviewNote || '', estimatedAmount: employee ? correctiveAmountPaise(entry, employee) / 100 : 0 };
  });
  const rows = db.employees.filter((employee) => employee.active).map((employee) => {
    const eligible = db.timeEntries.filter((entry) => entry.employeeId === employee.id && entry.type === 'corrective' && entry.status === 'approved' && entry.date.startsWith(sourceMonth) && findBug(entry.bugId)?.cause === 'original');
    const hours = eligible.reduce((sum, entry) => sum + entry.hours, 0);
    const rate = monthlyRate(employee);
    const rawLines = eligible.map((entry) => ({ timeId: entry.id, taskId: entry.taskId, bugId: entry.bugId, module: findTask(entry.taskId)?.module || 'Unknown module', hours: entry.hours, amountPaise: correctiveAmountPaise(entry, employee) }));
    const requestedPaise = rawLines.reduce((sum, line) => sum + line.amountPaise, 0);
    const grossPaise = Math.round(Number(employee.monthlySalary) * 100);
    const deductionPaise = Math.min(grossPaise, requestedPaise);
    let remainingPaise = deductionPaise;
    const lines = rawLines.map((line) => { const appliedPaise = Math.min(line.amountPaise, remainingPaise); remainingPaise -= appliedPaise; return { timeId: line.timeId, taskId: line.taskId, bugId: line.bugId, module: line.module, hours: line.hours, amount: line.amountPaise / 100, appliedAmount: appliedPaise / 100 }; });
    const gross = grossPaise / 100; const requestedDeduction = requestedPaise / 100; const deduction = deductionPaise / 100;
    return { employeeId: employee.id, employee: employee.name, gross, hours, rate, rateBasis: employee.payBasis === 'daily' ? `daily rate converted using ${employee.hoursPerDay || 8}h/day` : 'hourly rate', requestedDeduction, capApplied: requestedPaise > deductionPaise, deduction, net: Math.max(0, gross - deduction), lines };
  });
  const defectsFound = db.bugs.filter((bug) => bug.foundAt?.startsWith(sourceMonth)).map((bug) => { const task = findTask(bug.taskId); return { bugId: bug.id, taskId: bug.taskId, module: task?.module || 'Unknown module', ownerId: task?.ownerId || null }; });
  const eligibleInputs = inputRecords.filter((entry) => entry.status === 'approved' && entry.cause === 'original');
  const excludedExternalInputs = inputRecords.filter((entry) => entry.status === 'approved' && entry.cause === 'external');
  const excludedExternalEstimatePaise = excludedExternalInputs.reduce((sum, item) => {
    const entry = db.timeEntries.find((candidate) => candidate.id === item.timeId); const employee = findEmployee(item.employeeId);
    return sum + (entry && employee ? correctiveAmountPaise(entry, employee) : 0);
  }, 0);
  const sourceSummary = { defectsFound, correctiveHours: inputRecords.reduce((sum, entry) => sum + Number(entry.hours), 0), eligibleHours: eligibleInputs.reduce((sum, entry) => sum + Number(entry.hours), 0), excludedExternalHours: excludedExternalInputs.reduce((sum, entry) => sum + Number(entry.hours), 0), excludedExternalEstimate: excludedExternalEstimatePaise / 100, payrollAdjustment: rows.reduce((sum, row) => sum + row.deduction, 0) };
  return { month: targetMonth, sourceMonth, calculationVersion: 'paise-v1', inputRecords, sourceSummary, rows, totalGross: rows.reduce((sum, row) => sum + row.gross, 0), totalDeduction: sourceSummary.payrollAdjustment, totalNet: rows.reduce((sum, row) => sum + row.net, 0) };
}
function shiftMonthKey(key, offset) {
  const [year, monthNumber] = key.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
}
function managerPayrollPreviews() {
  const currentDate = new Date();
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const targetMonths = [-1, 0, 1, 2].map((offset) => shiftMonthKey(currentMonth, offset));
  return targetMonths.map((targetMonth) => {
    const report = db.payroll.find((item) => item.month === targetMonth) || payrollFor(targetMonth);
    return {
      month: report.month,
      sourceMonth: report.sourceMonth,
      finalized: Boolean(report.finalizedAt),
      totalDeduction: report.totalDeduction,
      sourceSummary: {
        correctiveHours: report.sourceSummary?.correctiveHours || 0,
        eligibleHours: report.sourceSummary?.eligibleHours || 0,
        excludedExternalHours: report.sourceSummary?.excludedExternalHours || 0,
        excludedExternalEstimate: report.sourceSummary?.excludedExternalEstimate || 0,
      },
      inputRecords: (report.inputRecords || []).map((entry) => ({
        timeId: entry.timeId,
        date: entry.date,
        employeeId: entry.employeeId,
        employee: entry.employee,
        taskId: entry.taskId,
        module: entry.module,
        bugId: entry.bugId,
        hours: entry.hours,
        status: entry.status,
        cause: entry.cause,
        estimatedAmount: entry.estimatedAmount,
      })),
      rows: (report.rows || []).map((row) => ({
        employeeId: row.employeeId,
        employee: row.employee,
        hours: row.hours,
        requestedDeduction: row.requestedDeduction,
        capApplied: row.capApplied,
        deduction: row.deduction,
        lines: (row.lines || []).map((line) => ({
          taskId: line.taskId,
          bugId: line.bugId,
          module: line.module,
          hours: line.hours,
          amount: line.amount,
          appliedAmount: line.appliedAmount,
        })),
      })),
    };
  });
}
function payrollBlockers(report) {
  const entries = db.timeEntries.filter((entry) => entry.type === 'corrective' && entry.date.startsWith(report.sourceMonth));
  const pendingHours = entries.filter((entry) => entry.status === 'pending');
  const causeReview = entries.filter((entry) => entry.status === 'approved' && findBug(entry.bugId)?.cause === 'pending');
  return { pendingHours, causeReview };
}
function validateRole(role, allowed) { if (!can(role, allowed)) throw new Error('This action is not available for the selected role.'); }

async function command(body, account) {
  const { name, role, employee } = actorInfo(account);
  const d = body.data || {};
  switch (body.action) {
    case 'createTask': {
      validateRole(role, ['team-lead', 'admin']);
      if (!d.title?.trim() || !d.module?.trim() || !findEmployee(d.ownerId) || !d.committedDate) throw new Error('Add a title, module, owner, and committed date.');
      const task = { id: uniqueId('T', db.tasks), module: d.module.trim(), project: d.project?.trim() || 'Meridian finance platform', title: d.title.trim(), ownerId: d.ownerId, status: 'Assigned', committedDate: d.committedDate, completedAt: null, priority: d.priority || 'Medium', tags: d.tags || [], history: [] };
      task.history.unshift(taskHistory('Assigned', new Date().toISOString(), name, 'Task assigned with a committed date.'));
      db.tasks.unshift(task); audit(name, role, 'Task assigned', `${task.id} · ${task.title} · ${findEmployee(task.ownerId).name}`); notify(task.ownerId, 'New task assigned', `${task.id} ${task.title} is due ${task.committedDate}.`, 'task');
      return task;
    }
    case 'advanceTask': {
      const task = findTask(d.taskId); if (!task) throw new Error('Task not found.');
      validateRole(role, ['employee', 'team-lead', 'admin']);
      if (role === 'employee' && task.ownerId !== employee?.id) throw new Error('You can only update your own assigned tasks.');
      const next = d.status;
      if (next === 'Under Fix') validateRole(role, ['team-lead', 'admin']);
      if (next === 'Closed') validateRole(role, ['team-lead', 'admin']);
      const permitted = { Assigned: ['In Progress'], 'In Progress': ['Completed'], Reopened: ['Under Fix'], 'Under Fix': ['Closed'] };
      if (!permitted[task.status]?.includes(next)) throw new Error(`Task cannot move from ${task.status} to ${next}.`);
      history(task, next, name, d.note?.trim() || `Moved to ${next}.`);
      if (next === 'Closed') { const closedAt = new Date().toISOString(); db.bugs.filter((item) => item.taskId === task.id && item.status !== 'Closed').forEach((bug) => { bug.status = 'Closed'; bug.closedAt = closedAt; }); }
      audit(name, role, 'Task status changed', `${task.id} · ${task.status}`); notify(task.ownerId, `Task ${next.toLowerCase()}`, `${task.id} ${task.title} is now ${next}.`, 'task');
      return task;
    }
    case 'reportBug': {
      const task = findTask(d.taskId); if (!task) throw new Error('Select the completed task where the defect was found.');
      validateRole(role, ['employee', 'team-lead', 'admin']);
      if (role === 'employee' && task.ownerId !== employee?.id && !['Completed', 'Closed'].includes(task.status)) throw new Error('Choose a completed module or task before reporting a defect.');
      if (!['Completed', 'Closed', 'Under Fix'].includes(task.status)) throw new Error('Defects can be raised against completed work.');
      if (!d.title?.trim() || !d.description?.trim() || !d.foundAt || !['Low', 'Medium', 'High', 'Critical'].includes(d.severity)) throw new Error('Add a title, description, severity, and date found.');
      const bugDate = new Date(`${d.foundAt}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(d.foundAt) || Number.isNaN(bugDate.valueOf()) || bugDate.toISOString().slice(0, 10) !== d.foundAt) throw new Error('Choose a valid date when the defect was found.');
      const bug = { id: uniqueId('B', db.bugs), taskId: task.id, title: d.title.trim(), description: d.description.trim(), severity: d.severity, foundAt: bugDate.toISOString(), reportedBy: employee?.id || 'emp-dev', status: 'Reopened', cause: 'pending', causeReason: '', reviewedBy: null, reviewedAt: null, closedAt: null, tags: d.tags?.length ? d.tags : d.title.toLowerCase().match(/[a-z0-9]{4,}/g) || [] };
      db.bugs.unshift(bug); history(task, 'Reopened', name, `${bug.id} reported: ${bug.title}`); notify(task.ownerId, 'A delivered task was reopened', `${bug.id} was linked to ${task.id}. The manager will review its cause before any payroll impact.`, 'task'); audit(name, role, 'Defect reported; task reopened', `${bug.id} · ${task.id} · original owner ${findEmployee(task.ownerId)?.name || 'Unassigned'}`);
      return bug;
    }
    case 'logHours': {
      validateRole(role, ['employee']); if (!employee) throw new Error('Select an employee profile.');
      const hours = Number(d.hours); if (!Number.isFinite(hours) || hours <= 0 || hours > 16 || Math.round(hours * 4) !== hours * 4) throw new Error('Enter hours from 0.25 to 16 in quarter-hour increments.');
      const date = d.date || today; const parsedDate = new Date(`${date}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Choose a valid work date.');
      if (d.type === 'corrective' && db.payroll.some((report) => report.sourceMonth === date.slice(0, 7))) throw new Error(`Payroll for corrective work logged in ${date.slice(0, 7)} is already finalized.`);
      const already = db.timeEntries.filter((entry) => entry.employeeId === employee.id && entry.date === date).reduce((sum, entry) => sum + entry.hours, 0); if (already + hours > 16) throw new Error('The total for this employee and date cannot exceed 16 hours.');
      let task; let bug = null;
      if (d.type === 'corrective') { bug = findBug(d.bugId); if (!bug || bug.status === 'Closed' || !['Reopened', 'Under Fix'].includes(bug.status)) throw new Error('Choose an open defect for corrective work.'); task = findTask(bug.taskId); if (task?.ownerId !== employee.id) throw new Error('Corrective hours must be logged by the employee responsible for the original delivery.'); }
      else { task = findTask(d.taskId); if (!task || task.ownerId !== employee.id || !['Assigned', 'In Progress'].includes(task.status)) throw new Error('Choose one of your active tasks for regular work.'); }
      if (!d.note?.trim()) throw new Error('Add a short work note.');
      const entry = { id: uniqueId('TIME', db.timeEntries), employeeId: employee.id, taskId: task.id, bugId: bug?.id || null, type: d.type === 'corrective' ? 'corrective' : 'regular', hours, note: d.note.trim(), date, status: d.type === 'corrective' ? 'pending' : 'approved', createdAt: new Date().toISOString(), reviewedBy: d.type === 'corrective' ? null : 'System', reviewedAt: d.type === 'corrective' ? null : new Date().toISOString(), reviewNote: d.type === 'corrective' ? '' : 'Regular work is excluded from corrective-hour deduction.' };
      db.timeEntries.unshift(entry); audit(name, role, d.type === 'corrective' ? 'Corrective hours submitted for review' : 'Regular hours logged', `${entry.hours}h · ${task.id} · ${bug?.id || 'new work'}`);
      if (d.type === 'corrective') notify(employee.id, 'Corrective hours submitted', `${hours} hour${hours === 1 ? '' : 's'} for ${bug.id} are awaiting manager review. They will not enter payroll until approved and the cause is confirmed.`, 'payroll');
      return entry;
    }
    case 'reviewHours': {
      validateRole(role, ['team-lead', 'admin']);
      const entry = db.timeEntries.find((item) => item.id === d.timeId); if (!entry || entry.type !== 'corrective' || entry.status !== 'pending') throw new Error('This corrective entry is no longer awaiting review.');
      const bug = findBug(entry.bugId); if (!bug) throw new Error('The linked defect is missing.');
      if (!d.note?.trim()) throw new Error('Record the reason for approving or rejecting these hours.');
      if (d.status === 'approved') { entry.status = 'approved'; entry.reviewNote = d.note.trim(); }
      else if (d.status === 'rejected') { entry.status = 'rejected'; entry.reviewNote = d.note.trim(); }
      else throw new Error('Choose approve or reject.');
      entry.reviewedBy = name; entry.reviewedAt = new Date().toISOString();
      audit(name, role, `Corrective hours ${entry.status}`, `${entry.hours}h · ${bug.id} · ${entry.reviewNote}`);
      const targetMonth = nextMonthKey(entry.date.slice(0, 7));
      const previewRow = entry.status === 'approved' && bug.cause === 'original' ? payrollFor(targetMonth).rows.find((row) => row.employeeId === entry.employeeId) : null;
      const estimate = previewRow?.deduction || 0;
      notify(entry.employeeId, entry.status === 'approved' ? 'Corrective hours approved' : 'Corrective hours declined', entry.status === 'approved' ? `${entry.hours} hours for ${bug.id} were approved. ${bug.cause === 'original' ? `${previewRow?.hours.toFixed(2) || entry.hours.toFixed(2)} eligible hours currently calculate to ₹${estimate.toLocaleString('en-IN')} for ${targetMonth}, before payroll is finalized.` : 'No payroll deduction is queued until the manager reviews the defect cause.'}` : `${entry.hours} hours for ${bug.id} were not approved. Reason: ${entry.reviewNote}`, 'payroll');
      return entry;
    }
    case 'classifyBug': {
      validateRole(role, ['manager', 'admin']);
      const bug = findBug(d.bugId); if (!bug) throw new Error('Defect not found.');
      if (!['original', 'external'].includes(d.cause) || !d.reason?.trim()) throw new Error('Choose a cause and record the review reason.');
      const finalized = db.payroll.find((report) => report.inputRecords?.some((entry) => entry.bugId === bug.id) || report.sourceSummary?.defectsFound?.some((item) => item.bugId === bug.id) || report.rows?.some((row) => row.lines?.some((line) => line.bugId === bug.id)));
      if (finalized) throw new Error(`The cause for ${bug.id} is part of finalized ${finalized.month} payroll and cannot be changed.`);
      bug.cause = d.cause; bug.causeReason = d.reason.trim(); bug.reviewedBy = name; bug.reviewedAt = new Date().toISOString();
      audit(name, role, d.cause === 'original' ? 'Delivery cause confirmed' : 'External cause confirmed', `${bug.id} · ${bug.causeReason}`);
      const accepted = db.timeEntries.filter((entry) => entry.bugId === bug.id && entry.type === 'corrective' && entry.status === 'approved');
      if (d.cause === 'original' && accepted.length) {
        const ownerId = findTask(bug.taskId)?.ownerId;
        for (const sourceMonth of new Set(accepted.map((entry) => entry.date.slice(0, 7)))) {
          const targetMonth = nextMonthKey(sourceMonth); const report = payrollFor(targetMonth); const row = report.rows.find((item) => item.employeeId === ownerId);
          notify(ownerId, 'Payroll estimate updated', `${bug.id} now has ${accepted.filter((entry) => entry.date.startsWith(sourceMonth)).reduce((sum, entry) => sum + entry.hours, 0).toFixed(2)} approved corrective hours attributed to original delivery. The full ${targetMonth} preview currently totals ₹${(row?.deduction || 0).toLocaleString('en-IN')} and can still change before finalization.`, 'payroll');
        }
      }
      else if (d.cause === 'external') notify(findTask(bug.taskId)?.ownerId, 'No rework deduction for this defect', `${bug.id} was reviewed as an external change. Its corrective hours are excluded from payroll deductions. Reason: ${bug.causeReason}`, 'payroll');
      return bug;
    }
    case 'updateRate': {
      validateRole(role, ['finance', 'admin']); const target = findEmployee(d.employeeId); if (!target) throw new Error('Employee not found.');
      const rate = Number(d.rate); const monthlySalary = Number(d.monthlySalary); const payBasis = d.payBasis;
      if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(monthlySalary) || monthlySalary < 0 || !['hourly','daily'].includes(payBasis)) throw new Error('Enter a valid hourly or daily rate and gross monthly salary.');
      target.payBasis = payBasis; target.monthlySalary = monthlySalary;
      if (payBasis === 'daily') { target.dailyRate = rate; target.hourlyRate = rate / (target.hoursPerDay || 8); }
      else { target.hourlyRate = rate; target.dailyRate = rate * (target.hoursPerDay || 8); }
      audit(name, role, 'Payroll rates updated', `${target.name} · ₹${rate}/${payBasis} · ₹${monthlySalary}/month`);
      const affectedMonths = new Set(db.timeEntries.filter((entry) => entry.employeeId === target.id && entry.type === 'corrective' && entry.status === 'approved' && findBug(entry.bugId)?.cause === 'original').map((entry) => entry.date.slice(0, 7)));
      for (const sourceMonth of affectedMonths) {
        const targetMonth = nextMonthKey(sourceMonth); if (db.payroll.some((report) => report.month === targetMonth)) continue;
        const row = payrollFor(targetMonth).rows.find((item) => item.employeeId === target.id);
        if (row?.hours) notify(target.id, 'Payroll estimate updated', `${row.hours.toFixed(2)} approved original-cause hours from ${sourceMonth} now calculate to ₹${row.deduction.toLocaleString('en-IN')} for ${targetMonth} at the updated ${payBasis} rate. Payroll has not been finalized.`, 'payroll');
      }
      return target;
    }
    case 'finalizePayroll': {
      validateRole(role, ['finance', 'admin']); const report = payrollFor(d.month);
      if (db.payroll.some((item) => item.month === d.month)) throw new Error(`Payroll for ${d.month} is already finalized.`);
      const blockers = payrollBlockers(report);
      if (blockers.pendingHours.length || blockers.causeReview.length) throw new Error(`Resolve ${blockers.pendingHours.length} pending hour review${blockers.pendingHours.length === 1 ? '' : 's'} and ${blockers.causeReview.length} unresolved cause review${blockers.causeReview.length === 1 ? '' : 's'} for ${report.sourceMonth} before finalizing.`);
      if (!d.note?.trim()) throw new Error('Record the finance review reason before finalizing payroll.');
      const saved = { ...report, id: `PAY-${d.month}`, finalizedAt: new Date().toISOString(), finalizedBy: name, finalizedReason: d.note.trim() };
      db.payroll = [saved, ...db.payroll.filter((item) => item.month !== d.month)];
      audit(name, role, 'Payroll deductions finalized', `${d.month} · ${report.rows.reduce((sum, row) => sum + row.hours, 0)} approved hours · ${report.inputRecords.length} source records captured · ₹${report.totalDeduction.toLocaleString('en-IN')} total deduction · ${saved.finalizedReason}`);
      for (const row of report.rows.filter((item) => item.hours > 0)) notify(row.employeeId, 'Payroll deductions finalized', `${row.hours} approved corrective hours worth ₹${row.deduction.toLocaleString('en-IN')} will appear on your ${d.month} payslip with the linked task and defect details.`, 'payroll');
      return saved;
    }
    case 'readNotice': {
      const notice = db.notices.find((item) => item.id === d.noticeId); if (!notice) throw new Error('Notice not found.');
      if (role === 'employee' && notice.employeeId !== employee?.id) throw new Error('This notice belongs to another employee.'); notice.read = true; return notice;
    }
    default: throw new Error('Unknown action.');
  }
}

function broadcast() {
  const payload = `event: update\ndata: ${JSON.stringify({ version: db.version, updatedAt: db.updatedAt })}\n\n`;
  for (const response of clients) response.write(payload);
}
async function readBody(req) {
  let content = ''; for await (const part of req) { content += part; if (content.length > 100000) throw new Error('Request is too large.'); }
  return JSON.parse(content || '{}');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/auth/status') return sendJson(res, 200, { setupRequired: db.accounts.length === 0 });
    if (req.method === 'GET' && url.pathname === '/api/auth/me') return sendJson(res, 200, { account: safeAccount(sessionAccount(req)) });
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const account = db.accounts.find((item) => item.email === email && item.active !== false);
      const validRole = ['employee', 'team-lead', 'manager', 'finance', 'admin'].includes(body.role);
      if (!validRole || !account || account.role !== body.role || !passwordMatches(String(body.password || ''), account) || (account.role === 'employee' && !db.employees.some((item) => item.id === account.employeeId && item.active))) {
        return sendJson(res, 401, { error: 'Email or password is incorrect for this portal.' });
      }
      newSession(res, account);
      return sendJson(res, 200, { account: safeAccount(account) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/request-account') {
      const body = await readBody(req);
      const operation = mutationQueue.then(async () => {
        const previous = db;
        db = structuredClone(db);
        try {
          if (db.accounts.length === 0) throw new Error('Set up the first administrator before requesting another portal account.');
          const account = createAccountRequest(body);
          await persist();
          broadcast();
          return account;
        } catch (error) { db = previous; throw error; }
      });
      mutationQueue = operation.catch(() => {});
      const account = await operation;
      return sendJson(res, 201, { account: safeAccount(account), approvalRequired: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { clearSession(req, res); return sendJson(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/auth/create-account') {
      const body = await readBody(req);
      const current = sessionAccount(req);
      const wasFirstAccount = db.accounts.length === 0;
      if (wasFirstAccount && body.role !== 'admin') return sendJson(res, 409, { error: 'Create the first administrator account before adding other roles.' });
      if (!wasFirstAccount && current?.role !== 'admin') return sendJson(res, current ? 403 : 401, { error: current ? 'Only an administrator can add accounts.' : 'Sign in as an administrator to add accounts.' });
      const operation = mutationQueue.then(async () => {
        const previous = db;
        db = structuredClone(db);
        try {
          if ((db.accounts.length === 0) !== wasFirstAccount) throw new Error('Account setup changed in another request. Reload and try again.');
          const account = createAccountRecord(body);
          await persist();
          broadcast();
          return account;
        } catch (error) { db = previous; throw error; }
      });
      mutationQueue = operation.catch(() => {});
      const account = await operation;
      if (wasFirstAccount) newSession(res, account);
      return sendJson(res, 201, { account: safeAccount(account), setupComplete: wasFirstAccount });
    }
    if (req.method === 'GET' && url.pathname === '/api/accounts') {
      const account = sessionAccount(req);
      if (!account) return sendJson(res, 401, { error: 'Sign in to view accounts.' });
      if (account.role !== 'admin') return sendJson(res, 403, { error: 'Only an administrator can view accounts.' });
      return sendJson(res, 200, { accounts: db.accounts.map(safeAccount) });
    }
    const approveAccountMatch = req.method === 'POST' && url.pathname.match(/^\/api\/accounts\/([^/]+)\/approve$/);
    if (approveAccountMatch) {
      const actor = sessionAccount(req);
      if (!actor) return sendJson(res, 401, { error: 'Sign in to review account requests.' });
      if (actor.role !== 'admin') return sendJson(res, 403, { error: 'Only an administrator can approve portal accounts.' });
      const body = await readBody(req);
      const accountId = decodeURIComponent(approveAccountMatch[1]);
      const operation = mutationQueue.then(async () => {
        const previous = db;
        db = structuredClone(db);
        try {
          const account = approveAccountRequest(accountId, body, actor);
          await persist();
          broadcast();
          return account;
        } catch (error) { db = previous; throw error; }
      });
      mutationQueue = operation.catch(() => {});
      const account = await operation;
      return sendJson(res, 200, { account: safeAccount(account) });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const account = sessionAccount(req);
      if (!account) return sendJson(res, 401, { error: 'Sign in to open the workspace.' });
      return sendJson(res, 200, publicWorkspace(account));
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (!sessionAccount(req)) return sendJson(res, 401, { error: 'Sign in to connect live updates.' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': 'same-origin' });
      res.write(`event: connected\ndata: ${JSON.stringify({ version: db.version, updatedAt: db.updatedAt })}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, version: db.version });
    if (req.method === 'POST' && url.pathname === '/api/command') {
      const account = sessionAccount(req);
      if (!account) return sendJson(res, 401, { error: 'Your session ended. Sign in again to save changes.' });
      const body = await readBody(req);
      const operation = mutationQueue.then(async () => {
        const previous = db;
        db = structuredClone(db);
        try {
          const result = await command(body, account);
          await persist();
          broadcast();
          return { result, version: db.version, updatedAt: db.updatedAt };
        } catch (error) {
          db = previous;
          throw error;
        }
      });
      mutationQueue = operation.catch(() => {});
      return sendJson(res, 200, await operation);
    }
    if (req.method !== 'GET') return sendJson(res, 404, { error: 'Not found.' });
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(publicRoot, `.${requested}`);
    if (!filePath.startsWith(publicRoot + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(bytes);
  } catch (error) {
    if (!res.headersSent) sendJson(res, error.statusCode || 400, { error: error.message || 'Request failed.' }); else res.end();
  }
});

await loadDb();
server.listen(port, '127.0.0.1', () => console.log(`Rework Ledger running at http://localhost:${port}`));

