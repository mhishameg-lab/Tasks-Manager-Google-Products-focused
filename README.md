# Personal Productivity Assistant

A personal productivity and accountability assistant built with Google Apps Script, Google Sheets, Google Tasks, Google Calendar, Telegram, and Gmail. Trello and Obsidian check-ins are manual reminders; this project does not use either service's API.

## How it works

```mermaid
flowchart TD
    U[You in Telegram] -->|Commands and button confirmations| W[Apps Script web app]
    W -->|Authorized, deduplicated updates| A[Assistant logic]
    A <--> T[Google Tasks<br/>authoritative task status]
    A <--> S[Google Sheets<br/>database, history, dashboard]
    A -->|Read appointments| C[Google Calendar]
    A -->|Only after explicit confirmation| C
    A -->|Reminders and reports| U
    A -->|Escalations and reports| G[Gmail]
    A -->|Manual check-in prompts| M[Trello and Obsidian]
    P[Time-driven triggers] --> A
```

Google Tasks determines task status. Sheets keeps synchronized records, logs, reviews, and history. Telegram delivery alone is never treated as task completion. Calendar events are created only after you confirm a Telegram preview.

## First-time setup

Complete these steps in order. The project does not automatically deploy itself or perform live integration checks.

### 1. Prepare Apps Script

1. Open the Apps Script project linked to the productivity database spreadsheet.
2. Add the `.gs` modules listed below and replace the project manifest with `appsscript.json`.
3. In **Services**, enable **Google Tasks API** (Advanced Service v1). Enable the associated Google Tasks API in the linked Google Cloud project if prompted.
4. Confirm the existing Script Properties are present. Do not copy their values into source code, Sheets, or this README:
   - `AUTHORIZED_TELEGRAM_USER_ID`
   - `GOOGLE_TASK_LIST_ID`
   - `SPREADSHEET_ID`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `WEBHOOK_SECRET`
   - `WEB_APP_URL`

### 2. Create and verify the database

1. From the Apps Script editor, run `setupDatabase()` and approve the requested permissions.
2. Open the spreadsheet and confirm the 15 required tabs exist: Dashboard, Tasks, Telegram_Messages, Telegram_Actions, Reminder_History, Task_History, Accountability_Routines, Accountability_Checkins, Daily_Reviews, Weekly_Reviews, Monthly_Reviews, Email_Escalations, System_Logs, Settings, and Sync_Logs.
3. Check that the Dashboard and its formulas/charts are present.
4. Run `syncGoogleTasks()` and verify the Tasks and Task_History tabs, plus Sync_Logs.

Setup preserves existing records and refuses to overwrite an unexpected header. Resolve any header error before continuing.

### 3. Deploy the Telegram web app

1. In Apps Script, select **Deploy → Manage deployments**.
2. Edit the Web App deployment, select **New version**, choose **Execute as: Me**, and set access to **Anyone** so Telegram can reach the endpoint.
3. Save the deployed `/exec` URL in the existing `WEB_APP_URL` Script Property. Do not include the webhook secret in that property.
4. Run `setTelegramWebhook()` from the editor, then run `getTelegramWebhookInfo()`.
5. Confirm the webhook is configured, `allowed_updates` includes both `message` and `callback_query`, `pending_update_count` is reasonable, and `last_error_message` is empty.

The registered webhook URL uses the existing secret. Treat deployment and execution logs as private. After code changes, deploy a new version; rerun `setTelegramWebhook()` if the deployment URL changes.

### 4. Test manually before enabling triggers

1. From the authorized Telegram account, try `/start`, `/help`, `/today`, `/tasks`, and `/review`.
2. Check incoming/outgoing messages in Telegram_Messages and callback results in Telegram_Actions.
3. Confirm a routine button once, then verify its exact confirmation timestamp in Accountability_Checkins. Check replay protection by repeating a callback.
4. Use a disposable task to test creation, completion, postponement, and cancellation. Cancellation requires a second explicit confirmation.
5. To test Calendar creation, send `/calendar TASK-ID | YYYY-MM-DD HH:mm | YYYY-MM-DD HH:mm`. Inspect the preview and confirm it only when correct.
6. Run `testEmailEscalation()` when ready to receive a labeled test message at the script's effective-user email. This does not create an escalation or change task status.
7. Run `runSystemHealthCheck()` and inspect the returned statuses and System_Logs.

Do not test task deletion or completion with real commitments.

### 5. Turn on scheduled automation

1. Run `installTriggers()`.
2. In Apps Script, open **Triggers** and verify all managed handlers appear.
3. Review **Executions** after the next scheduled runs. Run `runSystemHealthCheck()` again.
4. If needed, use `removeTriggers()` to remove only this project's managed triggers.

## Normal use

| What you want to do | Telegram command or action |
|---|---|
| See today's plan, appointments, and follow-ups | `/today` |
| See tomorrow's plan | `/tomorrow` |
| List pending tasks | `/tasks` |
| Review overdue work | `/overdue` |
| Create a task (requires confirmation) | `/addtask Task title \| High \| YYYY-MM-DD` |
| Schedule a pending task in Calendar (requires confirmation) | `/calendar TASK-ID \| YYYY-MM-DD HH:mm \| YYYY-MM-DD HH:mm` |
| Postpone or reschedule a task | `/postpone TASK-ID \| YYYY-MM-DD` |
| Confirm planning or review | `/review`, then choose a button |
| Complete a manual Trello or Obsidian check-in | `/habits`, then choose a button |
| Read progress or reports | `/progress`, `/weekly`, `/monthly` |
| See all supported commands | `/help` |

Routine times, reminder limits, and scoring weights are managed in the Settings tab. The timezone is `Africa/Cairo`.

## Project modules

- **Configuration and helpers:** `Config.gs`, `Utilities.gs`, `Logger.gs`
- **Database and dashboard:** `Database.gs`, `DatabaseSetup.gs`
- **Google services:** `GoogleTasks.gs`, `Calendar.gs`
- **Telegram interface:** `Telegram.gs`, `TelegramWebhook.gs`
- **Accountability and reminders:** `Accountability.gs`, `Reminders.gs`
- **Reports, email, operations:** `Reports.gs`, `EmailEscalation.gs`, `Setup.gs`
- **Runtime settings:** `appsscript.json`

## Safety and operating notes

- Google Tasks is authoritative for task status. Sheets retains task references and append-only history.
- The assistant never automatically completes or cancels a task. A Telegram message or reminder is not proof of completion.
- No Calendar event is created by sync; event creation requires a user-confirmed preview.
- Trello and Obsidian prompts are manual check-ins; no API integration is used.
- Secrets are read from Apps Script Properties, not stored in Sheets or printed in Telegram.
- Callback handling is deduplicated. Reminder cycles avoid replaying stale reminders after downtime; expired follow-ups are not sent in a burst.
- Appointment reminders are sent by Telegram near the event start when the reminder cycle runs; missed appointment reminders are not replayed.
- The code in this workspace has not itself verified live Google, Telegram, Gmail, spreadsheet, or trigger behavior. Complete the setup and test steps in the Apps Script project before relying on automation.

## Troubleshooting

- **Missing tab or header:** run `setupDatabase()` again. It adds missing structure but will stop if an existing header does not match.
- **Google Tasks sync fails:** verify Google Tasks Advanced Service v1 and its Cloud API are enabled, and that the configured task list is accessible.
- **Telegram gets no updates:** verify the `/exec` deployment URL, redeploy if needed, run `setTelegramWebhook()`, and inspect the sanitized `getTelegramWebhookInfo()` result.
- **A button click gets no chat reply:** deploy the latest code, run `setTelegramWebhook()`, and check Telegram_Actions for the callback result plus Apps Script **Executions** and System_Logs for errors. Failed callback rows include the sanitized error and its System_Logs reference. Button clicks are acknowledged immediately; the action result is sent as a separate chat message.
- **`/start` or `/help` creates no Telegram_Messages row:** check the latest `doPost` execution and `getTelegramWebhookInfo()`. Confirm the deployed URL is the latest `/exec` version, `allowed_updates` includes `message`, and there is no webhook error. If Telegram_Messages has a row marked `Rejected`, the sender does not match the authorized Telegram user ID.
- **Command is rejected:** use the Telegram account whose numeric user ID matches the existing `AUTHORIZED_TELEGRAM_USER_ID`.
- **Email is not delivered:** authorize email access, check the script's effective-user email and sending quota, then inspect Email_Escalations, Sync_Logs, and System_Logs.
- **Scheduled jobs do not run:** check Apps Script **Triggers** and **Executions**, run `runSystemHealthCheck()`, and reinstall with `installTriggers()` if appropriate.
- **A function is missing from the Run menu:** names ending in `_` are private helpers. Run the public entry points such as `setupDatabase`, `syncGoogleTasks`, `setTelegramWebhook`, `installTriggers`, `removeTriggers`, and `runSystemHealthCheck`.
