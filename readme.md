# Rework Ledger

Rework Ledger tracks task delivery, linked defects, corrective maintenance, manager review, and next-month payroll estimates in one local web app.

## Run locally

1. Install Node.js 20 or newer.
2. Open this folder in Visual Studio Code (`code .`).
3. In the VS Code terminal, run `node server.mjs`.
4. Open [http://localhost:4173](http://localhost:4173).

The app uses Node.js built-in modules, so there is no dependency install step. If npm is available, `npm start` runs the same server and `npm run dev` restarts it when source files change.

## Portal sign-in and accounts

On first run, choose **Set up the first administrator** on the portal chooser. That one-time setup creates the administrator login. Sign in, open **Accounts** in the sidebar, and create a separate login for each role. Employee accounts must be linked to an active employee profile. After setup, every portal requires the email and password for an account assigned to that role. Use **Sign out** to return to the chooser.

The app supports these role-specific pages and workflows:

- **Employee**: report a defect, log regular or corrective hours, review notices, and see a payslip preview.
- **Team lead**: assign tasks, move reopened tasks into fix, approve or reject corrective hours with a written reason, verify fixes, and view quality signals and the audit trail.
- **Manager**: review the linked delivery evidence and classify a defect as original-delivery or external with a written reason. An external cause is excluded; manager cause review never approves time by itself.
- **Finance**: edit rates, review monthly calculations, inspect linked payslip lines, and finalize payroll.
- **Administrator**: create and review portal accounts, oversee operational records, reports, decisions, and the audit trail.

Passwords are stored as salted scrypt hashes in the ignored local database file; the server issues an HttpOnly session cookie and derives action permissions from that session rather than trusting a role sent by the browser. The first administrator can only be created while the account list is empty. This local app is a development demonstration, not a production identity system: use HTTPS, an organization identity provider, a production database, and reviewed access controls before using real employee or payroll data.

## Data and live updates

The Node server saves the workspace to `data/workspace.json` after each accepted action. It sends Server-Sent Events to open tabs, which reload the saved state immediately when another action changes the database. A failed write rolls the action back in memory; malformed saved data stops startup instead of silently replacing it with demo data. Regular time entries and corrective hours have different types. The team lead reviews hours; the manager separately reviews defect cause. Payroll counts only approved corrective hours whose linked defect is confirmed as caused by the original delivery; an external cause, pending hours, and rejected hours are excluded. Monthly summaries can show the rate-based estimate for approved external-cause time, clearly marked as excluded and not deducted. The next payroll month is computed from the month in which the rework occurred.

The calculation is `min(gross monthly salary, approved eligible hours × hourly equivalent)`. A daily rate uses the employee's configured workday. The server rounds each time entry to paise, caps deductions at gross pay, and stores the source records, rate basis, and calculation version with finalized payroll. The UI shows paise when a value has a fractional rupee. The audit history records the actor, decision, time, and reason.

## Reset demo data

Stop the server, remove `data/workspace.json`, and start it again. The server will recreate the fictional sample workspace. The database file is ignored by Git.

## Before real payroll use

Use an organization identity provider and a secured production database with protected backups, define the applicable pay policy with finance and HR, and review local employment and payroll requirements. Keep payroll decisions reviewable and make no deduction without the approved hours, linked defect, cause decision, and recorded reason.

## Files

- `server.mjs` — local HTTP API, persistent JSON database, workflow validation, payroll calculation, and live event stream.
- `public/` — responsive app views, UI, and role-specific actions.
- `SAFE_BUILD_PROMPT.md` — reusable prompt with workflow, fairness, security, and calculation guardrails.
