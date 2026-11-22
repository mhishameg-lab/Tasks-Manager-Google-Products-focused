function doGet(e) {
  if (!e || !e.parameter || e.parameter.view !== 'taskform') {
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Productivity Assistant</title><p>Open this page from the Telegram bot.</p>'
    );
  }
  return HtmlService.createHtmlOutputFromFile('TaskMiniAppLayout')
    .setTitle('Add a task')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function submitTaskFromMiniApp(initData, payload) {
  const telegramUserId = verifyTelegramMiniAppInitData_(initData);
  if (!isAuthorizedTelegramUser_(telegramUserId)) {
    throw new Error('This Telegram account is not authorized to add tasks.');
  }
  if (!payload || typeof payload !== 'object') throw new Error('Task form data is missing.');
  const title = String(payload.title || '').trim();
  const area = String(payload.area || 'Other');
  const priority = String(payload.priority || 'Medium');
  const requestedDueDate = String(payload.dueDate || '');
  const doneTest = String(payload.doneTest || '').trim();
  const notes = String(payload.notes || '').trim();
  const requestId = String(payload.requestId || '');
  const createCalendarBlock = payload.createCalendarBlock === true;
  const addToTop3 = payload.addToTop3 === true;
  const dueDate = requestedDueDate || (addToTop3 ? dateKey_(now_()) : '');
  const blockStartValue = String(payload.blockStart || '');
  const blockEndValue = String(payload.blockEnd || '');

  if (!title || title.length > 500) throw new Error('Enter a task title up to 500 characters.');
  if (!TASK_AREAS.includes(area)) throw new Error('Choose a valid task area.');
  if (!['High', 'Medium', 'Low'].includes(priority)) throw new Error('Choose a valid priority.');
  if (dueDate && !isValidDateKey_(dueDate)) throw new Error('Choose a valid due date.');
  if (addToTop3 && !DAILY_OUTCOME_AREAS.includes(area)) {
    throw new Error('Choose DEEP, WORK, or LIFE to add this task to today’s Top 3.');
  }
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) throw new Error('Task form request is invalid; please submit again.');
  if (doneTest.length > 1000 || notes.length > 2000) throw new Error('Done test or notes are too long.');

  const start = blockStartValue ? parseMiniAppDateTime_(blockStartValue) : null;
  const end = blockEndValue ? parseMiniAppDateTime_(blockEndValue) : null;
  if (createCalendarBlock && (!start || !end || end <= start)) {
    throw new Error('Choose a valid start and end time for the Calendar block.');
  }

  const requestKey = `miniapp-request:${requestId}`;
  const cache = CacheService.getScriptCache();
  const cachedResult = cache.get(requestKey);
  if (cachedResult && cachedResult !== 'processing') return JSON.parse(cachedResult);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another request is being saved. Please try once more.');
  try {
    const repeated = cache.get(requestKey);
    if (repeated && repeated !== 'processing') return JSON.parse(repeated);
    const requestSheet = getSheet_(APP.SHEETS.MINI_APP_REQUESTS);
    const prior = requestSheet.getDataRange().getValues().slice(1)
      .find(row => String(row[0]) === requestId);
    if (prior) {
      if (prior[1]) {
        const task = getTaskRecordByGoogleId_(prior[1]);
        if (!task) throw new Error('This task request was already saved but its task record is unavailable.');
        const result = { success: true, taskId: task[1], title: task[2], repeated: true };
        cache.put(requestKey, JSON.stringify(result), 21600);
        return result;
      }
      throw new Error(
        'This request may have started creating a task but could not be confirmed. Check Google Tasks before submitting it again.'
      );
    }
    cache.put(requestKey, 'processing', 600);

    const requestRow = requestSheet.getLastRow() + 1;
    requestSheet.getRange(requestRow, 1, 1, 5)
      .setValues([[requestId, '', now_(), 'Started', '']]);
    const taskNotes = [
      `Area: ${area}`,
      doneTest ? `Done looks like: ${doneTest}` : '',
      notes ? `Notes: ${notes}` : ''
    ].filter(Boolean).join('\n');
    let task;
    let requestTaskPersisted = false;
    try {
      task = createGoogleTask_(title, priority, dueDate, taskNotes);
      requestSheet.getRange(requestRow, 2, 1, 4)
        .setValues([[task.id, now_(), 'Created', '']]);
      requestTaskPersisted = true;
      if (addToTop3) {
        appendDailyOutcome_(now_(), area, title, doneTest, task.id, 'Planned', '', '', '', 'Added from Telegram Mini App.');
      }

      const result = { success: true, taskId: task.id, title: task.title || title, repeated: false };
      let keyboard = [[{ text: 'Open today’s plan', callback_data: 'home_show_plan' }]];
      let message = `<b>Task added.</b>\n\n<b>${escapeHtml_(title)}</b>\n${escapeHtml_(area)} · ${escapeHtml_(priority)}` +
        `${dueDate ? `\nDue: ${escapeHtml_(dueDate)}` : ''}` +
        `${addToTop3 ? '\nAdded to today’s Top 3.' : ''}`;
      if (createCalendarBlock) {
        const draftId = Utilities.getUuid();
        const draft = {
          title: title,
          description: taskNotes,
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          startLabel: Utilities.formatDate(start, APP.TIMEZONE, 'yyyy-MM-dd HH:mm'),
          endLabel: Utilities.formatDate(end, APP.TIMEZONE, 'yyyy-MM-dd HH:mm'),
          outcomeDate: dateKey_(now_()),
          outcomeArea: addToTop3 ? area : '',
          taskId: task.id
        };
        cache.put(`calendar-draft:${draftId}`, JSON.stringify(draft), 3600);
        message += `\n\nCalendar preview: ${escapeHtml_(draft.startLabel)}–${escapeHtml_(draft.endLabel)}.`;
        keyboard = [[
          { text: 'Confirm Calendar block', callback_data: `calendar_create_confirm|${draftId}` },
          { text: 'Skip Calendar', callback_data: `calendar_create_discard|${draftId}` }
        ]];
      }
      try {
        sendTelegramMessage_(message, keyboard, 'Mini App task created', { taskId: task.id });
        result.notificationSent = true;
      } catch (error) {
        const errorId = logSystem_(
          'ERROR',
          'Task Mini App',
          'Telegram notification failed',
          'Task was saved, but the task-created Telegram message could not be delivered.',
          error,
          task.id
        );
        result.notificationSent = false;
        result.notificationReference = errorId;
      }
      cache.put(requestKey, JSON.stringify(result), 21600);
      return result;
    } catch (error) {
      if (!requestTaskPersisted) {
        requestSheet.getRange(requestRow, 4, 1, 2)
          .setValues([['Needs review', redactSensitiveText_(error && error.message || error)]]);
        cache.remove(requestKey);
      }
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function parseMiniAppDateTime_(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})T([0-2]\d):([0-5]\d)$/);
  if (!match || !isValidDateKey_(match[1]) || Number(match[2]) > 23) return null;
  const parsed = Utilities.parseDate(`${match[1]} ${match[2]}:${match[3]}`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
  return Utilities.formatDate(parsed, APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm") === value ? parsed : null;
}

function verifyTelegramMiniAppInitData_(initData) {
  const fields = {};
  String(initData || '').split('&').forEach(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return;
    const key = decodeURIComponent(part.slice(0, separator).replace(/\+/g, ' '));
    const value = decodeURIComponent(part.slice(separator + 1).replace(/\+/g, ' '));
    if (Object.prototype.hasOwnProperty.call(fields, key)) throw new Error('Telegram Mini App authentication data is invalid.');
    fields[key] = value;
  });
  const receivedHash = String(fields.hash || '');
  if (!/^[a-f0-9]{64}$/i.test(receivedHash) || !fields.user || !fields.auth_date) {
    throw new Error('Open the task form from the authorized Telegram bot.');
  }

  const token = requireConfig_(APP.PROPERTIES.TELEGRAM_BOT_TOKEN);
  const secretKey = Utilities.computeHmacSha256Signature(token, 'WebAppData');
  const checkString = Object.keys(fields)
    .filter(key => key !== 'hash')
    .sort()
    .map(key => `${key}=${fields[key]}`)
    .join('\n');
  const expectedHash = bytesToHex_(Utilities.computeHmacSha256Signature(checkString, secretKey));
  if (!constantTimeEquals_(expectedHash.toLowerCase(), receivedHash.toLowerCase())) {
    throw new Error('Telegram Mini App authentication failed. Reopen the form from Telegram.');
  }

  const authDate = Number(fields.auth_date);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isSafeInteger(authDate) || ageSeconds < -60 || ageSeconds > 86400) {
    throw new Error('Telegram Mini App session expired. Reopen the task form.');
  }
  let user;
  try {
    user = JSON.parse(fields.user);
  } catch (error) {
    throw new Error('Telegram Mini App user data is invalid.');
  }
  if (!user || !Number.isSafeInteger(Number(user.id))) throw new Error('Telegram Mini App user is invalid.');
  return String(user.id);
}

function bytesToHex_(bytes) {
  return bytes.map(byte => (`0${((byte + 256) % 256).toString(16)}`).slice(-2)).join('');
}

function constantTimeEquals_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
