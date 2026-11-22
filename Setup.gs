const MANAGED_TRIGGER_HANDLERS = [
  'runTelegramPollingCycle',
  'syncGoogleTasks',
  'runReminderCycle',
  'runDailyReview',
  'runWeeklyReview',
  'runMonthlyReview',
  'processEmailEscalations',
  'runSystemHealthCheck'
];

function installTriggers() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Could not acquire the trigger installation lock.');
  try {
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (MANAGED_TRIGGER_HANDLERS.includes(trigger.getHandlerFunction())) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    const created = [];
    created.push(ScriptApp.newTrigger('runTelegramPollingCycle').timeBased().everyMinutes(1).create());
    created.push(ScriptApp.newTrigger('syncGoogleTasks').timeBased().everyHours(1).create());
    created.push(ScriptApp.newTrigger('runReminderCycle').timeBased().everyMinutes(5).create());
    created.push(ScriptApp.newTrigger('runDailyReview').timeBased().atHour(23).nearMinute(30).everyDays(1).inTimezone(APP.TIMEZONE).create());
    created.push(ScriptApp.newTrigger('runWeeklyReview').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).inTimezone(APP.TIMEZONE).create());
    created.push(ScriptApp.newTrigger('runMonthlyReview').timeBased().onMonthDay(1).atHour(18).inTimezone(APP.TIMEZONE).create());
    created.push(ScriptApp.newTrigger('processEmailEscalations').timeBased().everyHours(2).create());
    created.push(ScriptApp.newTrigger('runSystemHealthCheck').timeBased().everyDays(1).atHour(6).inTimezone(APP.TIMEZONE).create());
    created.forEach(trigger => logSystem_(
      'INFO',
      'Triggers',
      'Installed',
      `Installed trigger for ${trigger.getHandlerFunction()}.`
    ));
    return created.length;
  } catch (error) {
    logSystem_('ERROR', 'Triggers', 'Install failed', 'Could not install all managed triggers.', error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function removeTriggers() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Could not acquire the trigger removal lock.');
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (MANAGED_TRIGGER_HANDLERS.includes(trigger.getHandlerFunction())) {
        ScriptApp.deleteTrigger(trigger);
        logSystem_('INFO', 'Triggers', 'Removed', `Removed trigger for ${trigger.getHandlerFunction()}.`);
        removed++;
      }
    });
    return removed;
  } catch (error) {
    logSystem_('ERROR', 'Triggers', 'Removal failed', 'Could not remove managed triggers.', error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function runWeeklyReview() {
  return withScriptLock_(() => runWeeklyReview_());
}

function runWeeklyReview_() {
  try {
    sendWeeklyReport_();
    logSystem_('INFO', 'Weekly review', 'Completed', 'Weekly report generated and delivered.');
  } catch (error) {
    logSystem_('ERROR', 'Weekly review', 'Failed', 'Weekly report generation or delivery failed.', error);
    throw error;
  }
}

function runMonthlyReview() {
  return withScriptLock_(() => runMonthlyReview_());
}

function runMonthlyReview_() {
  try {
    sendMonthlyReport_();
    logSystem_('INFO', 'Monthly review', 'Completed', 'Monthly report generated and delivered.');
  } catch (error) {
    logSystem_('ERROR', 'Monthly review', 'Failed', 'Monthly report generation or delivery failed.', error);
    throw error;
  }
}

function sendReportEmail_(subject, htmlBody, periodKey) {
  const recipient = Session.getEffectiveUser().getEmail();
  if (!recipient) {
    const error = new Error('No effective-user email is available for report delivery.');
    logSystem_('ERROR', 'Reports', 'Email unavailable', 'Could not deliver the scheduled report by email.', error);
    throw error;
  }
  const operation = `Report: ${subject}: ${periodKey || dateKey_(now_())}`;
  const logs = getSheet_(APP.SHEETS.SYNC_LOGS).getDataRange().getValues();
  const alreadySent = logs.some((row, index) =>
    index > 0 && row[1] === 'Gmail' && row[2] === operation &&
    row[4] === 'Success'
  );
  if (alreadySent) return false;
  try {
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      htmlBody: htmlBody
    });
    logSync_('Gmail', operation, 'Success', '', 0);
    return true;
  } catch (error) {
    logSync_('Gmail', operation, 'Failed', error.message, 0);
    logSystem_('ERROR', 'Reports', 'Email delivery failed', 'Could not deliver a scheduled report by email.', error);
    throw error;
  }
}

function runSystemHealthCheck() {
  const result = {
    checkedAt: formatDateTime_(now_()),
    sheets: 'Failed',
    dashboard: 'Failed',
    tasks: 'Failed',
    calendar: 'Failed',
    telegram: 'Failed',
    email: 'Failed',
    triggers: 'Failed',
    recentFailures: 0
  };
  try {
    const spreadsheet = getDb_();
    const requiredHeaders = {
      Tasks: ['Internal Record ID', 'Google Task ID', 'Task Title', 'Description', 'Status', 'Priority', 'Creation Date', 'Due Date', 'Completion Date', 'Last Updated', 'Postponement Count', 'Last Reminder', 'Escalation Status', 'Notes'],
      Telegram_Messages: ['Message Log ID', 'Telegram Chat ID', 'Telegram Message ID', 'Direction', 'Message Type', 'Message Category', 'Message Content', 'Related Task ID', 'Related Routine ID', 'Timestamp', 'Delivery Status', 'Error Details', 'Callback Information'],
      Telegram_Actions: ['Action ID', 'Telegram User ID', 'Callback Query ID', 'Button Identifier', 'Action Name', 'Related Task or Routine', 'Action Result', 'Timestamp', 'Error Details'],
      Reminder_History: ['Reminder ID', 'Reminder Category', 'Related Task or Routine', 'Scheduled Time', 'Actual Sent Time', 'Reminder Number', 'Delivery Status', 'User Response', 'Confirmation Time', 'Follow-up Scheduled Time'],
      Task_History: ['Task ID', 'Previous Status', 'New Status', 'Previous Due Date', 'New Due Date', 'Action Type', 'Source of Action', 'Timestamp', 'History ID'],
      Accountability_Routines: ['Routine ID', 'Routine Name', 'Frequency', 'Scheduled Time', 'Active Status', 'Reminder Configuration', 'Maximum Reminders', 'Description'],
      Accountability_Checkins: ['Check-in ID', 'Routine ID', 'Date', 'Status', 'Confirmation Method', 'Confirmation Timestamp', 'Reminder Count', 'Postponement Count', 'Notes', 'Tasks Scheduled'],
      Daily_Reviews: ['Date', 'Total Tasks', 'Completed Tasks', 'Incomplete Tasks', 'Postponed Tasks', 'Overdue Tasks', 'Daily Planning Completed', 'Trello Routine Completed', 'Obsidian Routine Completed', 'Daily Review Completed', 'Accountability Score', 'Observations'],
      Weekly_Reviews: ['Week Starting Date', 'Tasks Created', 'Tasks Completed', 'Tasks Overdue', 'Postponements', 'Planning Consistency', 'Trello Maintenance Rate', 'Obsidian Maintenance Rate', 'Average Accountability Score', 'Repeated Problems', 'Recommendations'],
      Monthly_Reviews: ['Month', 'Tasks Created', 'Tasks Completed', 'Task Completion Rate', 'Overdue Tasks', 'Postponements', 'Planning Consistency', 'Trello Maintenance Rate', 'Obsidian Maintenance Rate', 'Average Accountability Score', 'Recurring Problems', 'Improvements', 'Recommendations'],
      Email_Escalations: ['Escalation ID', 'Related Task ID', 'Recipient', 'Email Subject', 'Escalation Reason', 'Escalation Level', 'Sent Timestamp', 'Delivery Result', 'Previous Escalations'],
      System_Logs: ['Log ID', 'Timestamp', 'Severity', 'Component', 'Event Type', 'Description', 'Execution ID', 'Related Record ID', 'Error Message', 'Stack Trace'],
      Settings: ['Setting Key', 'Setting Value', 'Description', 'Category', 'Last Updated'],
      Sync_Logs: ['Sync Log ID', 'Source', 'Operation', 'Timestamp', 'Result', 'Error Details', 'Retry Count', 'Related Record ID']
    };
    const missing = Object.keys(requiredHeaders).filter(name => {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet || sheet.getLastColumn() < requiredHeaders[name].length) return true;
      const actual = sheet.getRange(1, 1, 1, requiredHeaders[name].length).getValues()[0];
      return requiredHeaders[name].some((header, index) => actual[index] !== header);
    });
    if (!spreadsheet.getSheetByName(APP.SHEETS.DASHBOARD)) missing.push(APP.SHEETS.DASHBOARD);
    if (missing.length) throw new Error(`Missing tabs or mismatched headers: ${missing.join(', ')}`);
    result.sheets = 'OK';
    const dashboard = spreadsheet.getSheetByName(APP.SHEETS.DASHBOARD);
    const dashboardFormulas = dashboard.getRange('B5:B18').getFormulas().flat();
    const dashboardErrors = dashboard.getDataRange().getDisplayValues().flat()
      .filter(value => /^#(REF!|ERROR!|NAME\?|VALUE!)/.test(value));
    if (dashboardFormulas.some(formula => !formula) || !dashboard.getCharts().length || dashboardErrors.length) {
      throw new Error('Dashboard formulas or chart are missing or contain spreadsheet errors.');
    }
    result.dashboard = 'OK';

    Tasks.Tasklists.get(getProductivityTaskListId_());
    result.tasks = 'OK';

    CalendarApp.getDefaultCalendar().getId();
    result.calendar = 'OK';

    requireConfig_(APP.PROPERTIES.TELEGRAM_BOT_TOKEN);
    requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID);
    requireConfig_(APP.PROPERTIES.AUTHORIZED_TELEGRAM_USER_ID);
    const webhook = getTelegramWebhookInfo();
    result.telegram = webhook.configured
      ? 'Webhook still configured; run enableTelegramPolling()'
      : 'OK — polling mode';
    result.email = Session.getEffectiveUser().getEmail() ? 'OK' : 'Recipient unavailable';
    result.emailQuota = MailApp.getRemainingDailyQuota();

    const triggers = ScriptApp.getProjectTriggers().map(trigger => trigger.getHandlerFunction());
    const missingTriggers = MANAGED_TRIGGER_HANDLERS.filter(handler => !triggers.includes(handler));
    result.triggers = missingTriggers.length ? `Missing: ${missingTriggers.join(', ')}` : 'OK';

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const logs = getSheet_(APP.SHEETS.SYSTEM_LOGS).getDataRange().getValues();
    result.recentFailures = logs.slice(1).filter(row =>
      row[2] === 'ERROR' && row[1] && new Date(row[1]).getTime() >= cutoff
    ).length;
    result.ok = result.sheets === 'OK' && result.dashboard === 'OK' && result.tasks === 'OK' &&
      result.calendar === 'OK' && result.telegram === 'OK' &&
      result.email === 'OK' && result.triggers === 'OK' && result.recentFailures === 0;
    logSystem_(result.ok ? 'INFO' : 'WARNING', 'Health check', 'Completed', JSON.stringify(result));
    return result;
  } catch (error) {
    result.error = redactSensitiveText_(error.message);
    logSystem_('ERROR', 'Health check', 'Failed', 'System health check found a blocking error.', error);
    return result;
  }
}
