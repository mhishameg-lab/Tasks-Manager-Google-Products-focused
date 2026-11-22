function getDb_() {
  const id = getConfig_(APP.PROPERTIES.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('SPREADSHEET_ID is not configured and no active spreadsheet is available.');
  return active;
}

function getSheet_(sheetName) {
  const sheet = getDb_().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing database sheet: ${sheetName}`);
  return sheet;
}

function dateKey_(date) {
  return Utilities.formatDate(
    new Date(date),
    APP.TIMEZONE,
    'yyyy-MM-dd'
  );
}

function logTelegramMessage_(data) {
  getSheet_('Telegram_Messages').appendRow([
    newId_('MSG'),
    data.chatId || '',
    data.messageId || '',
    data.direction || '',
    data.type || '',
    data.category || '',
    data.content || '',
    data.taskId || '',
    data.routineId || '',
    now_(),
    data.deliveryStatus || '',
    data.errorDetails || '',
    data.callbackInfo || ''
  ]);
}

function logTelegramAction_(data) {
  const sheet = getSheet_('Telegram_Actions');
  const row = [
    newId_('ACT'),
    data.telegramUserId || '',
    data.callbackQueryId || '',
    data.buttonIdentifier || '',
    data.actionName || '',
    data.relatedTaskOrRoutine || '',
    data.actionResult || '',
    now_(),
    data.errorDetails || ''
  ];
  const rowIndex = sheet.getLastRow() + 1;
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return rowIndex;
}

function updateTelegramAction_(rowIndex, result, errorDetails) {
  const sheet = getSheet_(APP.SHEETS.TELEGRAM_ACTIONS);
  sheet.getRange(rowIndex, 7).setValue(result);
  if (errorDetails) sheet.getRange(rowIndex, 9).setValue(redactSensitiveText_(errorDetails));
}

function isDuplicateCallback_(callbackQueryId) {
  if (!callbackQueryId) return false;
  const sheet = getSheet_('Telegram_Actions');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return false;

  const values = sheet
    .getRange(2, 3, lastRow - 1, 1)
    .getValues()
    .flat()
    .map(String);
  return values.includes(String(callbackQueryId));
}

function recordRoutineCheckin_(routineId, status, method, notes, tasksScheduled, activityDate) {
  const sheet = getSheet_('Accountability_Checkins');
  const today = dateKey_(activityDate || now_());
  const timestamp = now_();
  const existing = sheet.getDataRange().getValues().some((row, index) =>
    index > 0 && String(row[1]) === String(routineId) &&
    normalizeDateKey_(row[2]) === today && String(row[3]) === String(status)
  );
  if (existing) return false;
  const reminderRows = getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues().slice(1)
    .filter(row => String(row[2]) === String(routineId) && row[3] && normalizeDateKey_(row[3]) === today);
  const reminderCount = reminderRows.filter(row => row[4] && row[6] === 'Sent').length;
  const postponementCount = reminderRows.filter(row => String(row[7]).toLowerCase().includes('reminder later')).length;

  const row = [
    newId_('CHECK'),
    routineId,
    today,
    status,
    method || 'Telegram',
    timestamp,
    reminderCount,
    postponementCount,
    notes || '',
    Number(tasksScheduled || 0)
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  if (status === 'Completed' || status === 'Missed') {
    const reminderSheet = getSheet_(APP.SHEETS.REMINDER_HISTORY);
    reminderSheet.getDataRange().getValues().forEach((reminder, index) => {
      if (index === 0 || String(reminder[2]) !== String(routineId) ||
          normalizeDateKey_(reminder[3]) !== today ||
          !['Sent', 'Scheduled'].includes(String(reminder[6])) ||
          ['Confirmed', 'Ignored'].includes(String(reminder[7]))) return;
      reminderSheet.getRange(index + 1, 8, 1, 2).setValues([[
        status === 'Completed' ? 'Confirmed' : 'Ignored',
        status === 'Completed' ? timestamp : ''
      ]]);
    });
  }
  return true;
}

function logTaskHistory_(taskId, previousStatus, newStatus, previousDueDate, newDueDate, actionType, source) {
  const sheet = getSheet_('Task_History');
  const row = [
    taskId,
    previousStatus || '',
    newStatus || '',
    previousDueDate || '',
    newDueDate || '',
    actionType,
    source,
    now_(),
    newId_('TH')
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}