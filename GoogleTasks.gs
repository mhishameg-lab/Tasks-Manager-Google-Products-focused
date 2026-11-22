function getProductivityTaskListId_() {
  return requireConfig_(APP.PROPERTIES.GOOGLE_TASK_LIST_ID);
}

function syncGoogleTasks() {
  return withSyncLock_(() => {
    let pageToken;
    let retryCount = 0;
    const googleTasks = [];
    try {
      do {
        const page = retryTransient_(() => Tasks.Tasks.list(getProductivityTaskListId_(), {
          showCompleted: true,
          showHidden: true,
          showDeleted: true,
          maxResults: 100,
          pageToken: pageToken
        }), 3, () => retryCount++);
        (page.items || []).forEach(task => {
          upsertTaskFromGoogle_(task);
          googleTasks.push(task);
        });
        pageToken = page.nextPageToken;
      } while (pageToken);
      logSync_('Google Tasks', 'Synchronize tasks', 'Success', '', retryCount);
      logSystem_('INFO', 'Google Tasks', 'Sync', `Synchronized ${googleTasks.length} tasks.`);
      return googleTasks;
    } catch (error) {
      logSync_('Google Tasks', 'Synchronize tasks', 'Failed', error.message, error.retryCount || retryCount);
      logSystem_('ERROR', 'Google Tasks', 'Sync', 'Task synchronization failed.', error);
      throw error;
    }
  });
}

function upsertTaskFromGoogle_(googleTask, actionSource, actionType) {
  const sheet = getSheet_('Tasks');
  const lastRow = sheet.getLastRow();

  const values = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 14).getValues()
    : [];

  const existingIndex = values.findIndex(row => String(row[1]) === String(googleTask.id));
  const existing = existingIndex >= 0 ? values[existingIndex] : null;
  const dueDate = googleTask.due ? googleTask.due.substring(0, 10) : '';
  const completedDate = googleTask.completed
    ? googleTask.completed.substring(0, 10)
    : '';
  const status = googleTask.deleted
    ? 'Deleted'
    : googleTask.status === 'completed' ? 'Completed' : 'Pending';

  const row = [
    existing ? existing[0] : newId_('TASK'),
    googleTask.id,
    googleTask.title || '',
    googleTask.notes || '',
    status,
    existing ? existing[5] : 'Medium',
    existing ? existing[6] : now_(),
    dueDate,
    completedDate,
    now_(),
    existing ? existing[10] : 0,
    existing ? existing[11] : '',
    existing && normalizeDateKey_(existing[7]) === dueDate ? existing[12] : 'None',
    existing ? existing[13] : ''
  ];

  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, row.length).setValues([row]);
    if (existing[4] !== status || String(existing[7] || '') !== dueDate) {
      logTaskHistory_(
        row[0], existing[4], status, existing[7], dueDate,
        actionType || (existing[4] !== status ? 'Status synchronized' : 'Due date synchronized'),
        actionSource || 'Google Tasks'
      );
    }
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    logTaskHistory_(row[0], '', status, '', dueDate, 'Created', 'Google Tasks');
  }
}

function getTasksForDate_(date) {
  const targetDate = dateKey_(date);
  const sheet = getSheet_('Tasks');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 14)
    .getValues()
    .filter(row =>
      row[4] === 'Pending' &&
      row[7] &&
      dateKey_(row[7]) === targetDate
    );
}

function getOverdueTasks_() {
  const today = dateKey_(now_());
  const sheet = getSheet_('Tasks');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 14)
    .getValues()
    .filter(row =>
      row[4] === 'Pending' &&
      row[7] &&
      dateKey_(row[7]) < today
    );
}

function createGoogleTask_(title, priority, dueDate, notes) {
  return withSyncLock_(() => {
    const listId = getProductivityTaskListId_();
    if (!String(title || '').trim()) throw new Error('Task title is required.');
    if (priority && !['High', 'Medium', 'Low'].includes(priority)) {
      throw new Error('Priority must be High, Medium, or Low.');
    }
    if (dueDate && !isValidDateKey_(dueDate)) {
      throw new Error('Due date must be a real date in YYYY-MM-DD format.');
    }

    const task = Tasks.Tasks.insert({
      title: String(title).trim(),
      notes: notes || '',
      due: dueDate ? `${dueDate}T00:00:00.000Z` : undefined
    }, listId);
    upsertTaskFromGoogle_(task);

    const sheet = getSheet_('Tasks');
    const rows = sheet.getDataRange().getValues();
    const taskRow = rows.findIndex(row => String(row[1]) === String(task.id));
    if (taskRow > 0) sheet.getRange(taskRow + 1, 6).setValue(priority || 'Medium');
    return task;
  });
}

function completeGoogleTask_(googleTaskId) {
  return withSyncLock_(() => {
    const listId = getProductivityTaskListId_();
    const previous = getTaskRecordByGoogleId_(googleTaskId);
    if (!previous || previous[4] !== 'Pending') throw new Error('Only pending tasks can be completed.');
    const task = retryTransient_(() => Tasks.Tasks.patch({
      status: 'completed'
    }, listId, googleTaskId), 3);

    upsertTaskFromGoogle_(task, 'Telegram', 'Completed');
    return task;
  });
}

function getTaskRecordByGoogleId_(googleTaskId) {
  const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues();
  return rows.slice(1).find(row => String(row[1]) === String(googleTaskId)) || null;
}

function postponeGoogleTask_(googleTaskId, newDueDate) {
  return withSyncLock_(() => {
    if (!isValidDateKey_(newDueDate)) {
      throw new Error('New due date must be a real date in YYYY-MM-DD format.');
    }
    const previous = getTaskRecordByGoogleId_(googleTaskId);
    if (!previous || previous[4] !== 'Pending') throw new Error('Only pending tasks can be postponed.');
    const task = retryTransient_(() => Tasks.Tasks.patch({
      due: `${newDueDate}T00:00:00.000Z`
    }, getProductivityTaskListId_(), googleTaskId), 3);
    upsertTaskFromGoogle_(task, 'Telegram', 'Postponed');
    const sheet = getSheet_(APP.SHEETS.TASKS);
    const rowIndex = sheet.getDataRange().getValues().findIndex(row => String(row[1]) === String(googleTaskId));
    if (rowIndex > 0) sheet.getRange(rowIndex + 1, 11).setValue(Number(previous[10] || 0) + 1);
    return task;
  });
}

function cancelGoogleTask_(googleTaskId) {
  return withSyncLock_(() => {
    const previous = getTaskRecordByGoogleId_(googleTaskId);
    if (!previous || previous[4] !== 'Pending') throw new Error('Only pending tasks can be cancelled.');
    Tasks.Tasks.remove(getProductivityTaskListId_(), googleTaskId);
    const sheet = getSheet_(APP.SHEETS.TASKS);
    const rowIndex = sheet.getDataRange().getValues().findIndex(row => String(row[1]) === String(googleTaskId));
    if (rowIndex > 0) {
      sheet.getRange(rowIndex + 1, 5).setValue('Cancelled');
      sheet.getRange(rowIndex + 1, 10).setValue(now_());
    }
    logTaskHistory_(previous[0], previous[4], 'Cancelled', previous[7], previous[7], 'Cancelled after confirmation', 'Telegram');
  });
}