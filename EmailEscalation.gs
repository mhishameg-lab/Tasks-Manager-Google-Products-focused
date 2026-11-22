function processEmailEscalations() {
  return withScriptLock_(() => processEmailEscalations_());
}

function processEmailEscalations_() {
  syncGoogleTasks();
  const recipient = Session.getEffectiveUser().getEmail();
  if (!recipient) {
    const error = new Error('No effective-user email is available for escalation.');
    logSystem_('ERROR', 'Email escalation', 'Recipient unavailable', 'Could not deliver task escalation.', error);
    throw error;
  }
  const thresholdHours = Number(getSetting_('EMAIL_ESCALATION_HOURS', 24));
  const now = now_();
  const tasks = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1);
  const escalations = getSheet_(APP.SHEETS.EMAIL_ESCALATIONS).getDataRange().getValues();
  let sentCount = 0;
  tasks.forEach(task => {
    if (task[4] !== 'Pending' || !task[7]) return;
    const due = new Date(`${dateKey_(task[7])}T00:00:00`);
    const hoursOverdue = Math.floor((now.getTime() - due.getTime()) / 3600000);
    if (hoursOverdue < thresholdHours) return;
    const reason = `Overdue since ${dateKey_(task[7])}`;
    const alreadySent = escalations.some((row, index) =>
      index > 0 && String(row[1]) === String(task[0]) && String(row[4]) === reason &&
      String(row[7]) === 'Sent'
    );
    if (alreadySent) return;
    const reminderCount = getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues()
      .filter((row, index) => index > 0 && String(row[2]) === String(task[0])).length;
    if (!reminderCount) return;
    const subject = `Productivity follow-up: ${task[2]}`;
    const body = [
      `Task: ${task[2]}`,
      `Original due date: ${getOriginalTaskDueDate_(task[0], task[7])}`,
      `Current due date: ${dateKey_(task[7])}`,
      `Current status: ${task[4]}`,
      `Postponement count: ${Number(task[10] || 0)}`,
      `Reminder count: ${reminderCount}`,
      `Time overdue: ${hoursOverdue} hours`,
      'Recommended action: review the task and choose to complete, postpone, or cancel it explicitly.'
    ].join('\n');
    try {
      MailApp.sendEmail(recipient, subject, body);
      appendEscalation_(task, recipient, subject, reason, 'Sent', escalations);
      updateTaskEscalation_(task[0], 'Escalated');
      sentCount++;
    } catch (error) {
      appendEscalation_(task, recipient, subject, reason, 'Failed', escalations);
      updateTaskEscalation_(task[0], 'Failed');
      logSystem_('ERROR', 'Email escalation', 'Delivery failed', 'Could not send escalation email.', error, task[0]);
      throw error;
    }
  });
  logSystem_('INFO', 'Email escalation', 'Completed', `Sent ${sentCount} escalation email(s).`);
  return sentCount;
}

function appendEscalation_(task, recipient, subject, reason, result, existingRows) {
  const previous = existingRows.filter((row, index) => index > 0 && String(row[1]) === String(task[0])).length;
  const sheet = getSheet_(APP.SHEETS.EMAIL_ESCALATIONS);
  const row = [newId_('EMAIL'), task[0], recipient, subject, reason, 'Task overdue', now_(), result, previous];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function testEmailEscalation() {
  const recipient = Session.getEffectiveUser().getEmail();
  if (!recipient) throw new Error('No active-user email is available. Run this from the authorized account.');
  MailApp.sendEmail(
    recipient,
    '[TEST] Productivity Assistant email escalation',
    'This is a safe test of Gmail delivery. No task status was changed and no escalation was created.'
  );
  logSystem_('INFO', 'Email escalation', 'Test sent', 'Safe test escalation email sent to the active user.');
  return 'Test email sent to the active user.';
}

function getOriginalTaskDueDate_(taskRecordId, fallback) {
  const history = getSheet_(APP.SHEETS.TASK_HISTORY).getDataRange().getValues();
  const created = history.slice(1).find(row =>
    String(row[0]) === String(taskRecordId) && String(row[5]) === 'Created'
  );
  return created && created[4] ? dateKey_(created[4]) : dateKey_(fallback);
}

function updateTaskEscalation_(taskRecordId, status) {
  const sheet = getSheet_(APP.SHEETS.TASKS);
  const values = sheet.getDataRange().getValues();
  const index = values.findIndex((row, rowIndex) =>
    rowIndex > 0 && String(row[0]) === String(taskRecordId)
  );
  if (index > 0) {
    sheet.getRange(index + 1, 13).setValue(status);
    sheet.getRange(index + 1, 10).setValue(now_());
  }
}
