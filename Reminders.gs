function runReminderCycle() {
  return withScriptLock_(() => runReminderCycle_());
}

function runReminderCycle_() {
  const now = now_();
  const todayKey = dateKey_(now);
  const time = Utilities.formatDate(now, APP.TIMEZONE, 'HH:mm');
  const minute = Number(time.slice(3));
  const minutesAfterMidnight = Number(time.slice(0, 2)) * 60 + minute;
  try {
    const planningTimes = [
      getSetting_('PLANNING_REMINDER_1', '00:00'),
      getSetting_('PLANNING_REMINDER_2', '00:20'),
      getSetting_('PLANNING_REMINDER_3', '00:45')
    ];
    const planningConfirmed = getConfirmedRoutine_('ROUTINE-DAILY-PLAN', now);
    const planningWindowStart = String(getSetting_('PLANNING_WINDOW_START', '00:00'));
    const planningWindowEnd = String(getSetting_('PLANNING_WINDOW_END', '01:00'));
    const windowStartParts = planningWindowStart.split(':').map(Number);
    const windowEndParts = planningWindowEnd.split(':').map(Number);
    const planningStartMinute = windowStartParts[0] * 60 + windowStartParts[1];
    const planningEndMinute = windowEndParts[0] * 60 + windowEndParts[1];
    if (!planningConfirmed && minutesAfterMidnight >= planningStartMinute &&
        minutesAfterMidnight < planningEndMinute) {
      planningTimes.forEach((scheduledTime, index) => {
        const parts = String(scheduledTime).split(':').map(Number);
        const scheduledMinute = parts[0] * 60 + parts[1];
        if (minutesAfterMidnight >= scheduledMinute && minutesAfterMidnight <= scheduledMinute + 6 &&
            scheduledMinute >= planningStartMinute && scheduledMinute < planningEndMinute &&
            !hasReminderFor_('ROUTINE-DAILY-PLAN', todayKey, scheduledTime)) {
          sendDailyPlanningPrompt_();
          recordReminder_('Routine', 'ROUTINE-DAILY-PLAN', scheduledTime, 'Sent', index + 1);
        }
      });
    } else if (!planningConfirmed && minutesAfterMidnight >= planningEndMinute) {
      recordRoutineCheckin_('ROUTINE-DAILY-PLAN', 'Missed', 'System', 'No planning confirmation by 01:00.');
      markIgnoredReminders_(['ROUTINE-DAILY-PLAN'], todayKey);
      upsertDailyPlanningReview_(now, false);
    }

    const morningTime = String(getSetting_('MORNING_REMINDER_TIME', '07:30'));
    if (isWithinTimeWindow_(morningTime) && !hasReminderFor_('MORNING', todayKey, morningTime)) {
      sendTodayBriefing_();
      recordReminder_('Morning briefing', 'MORNING', morningTime, 'Sent', 1);
    }
    const workBriefingTime = String(getSetting_('WORK_BRIEFING_TIME', '14:15'));
    if (isWithinTimeWindow_(workBriefingTime) && !hasReminderFor_('WORK-BRIEFING', todayKey, workBriefingTime)) {
      startWorkBriefing_();
      recordReminder_('SDR work briefing', 'WORK-BRIEFING', workBriefingTime, 'Sent', 1);
    }
    const eveningReviewTime = String(getSetting_('EVENING_REVIEW_TIME', '22:30'));
    if (isWithinTimeWindow_(eveningReviewTime) &&
        !hasReminderFor_('EVENING-REVIEW', todayKey, eveningReviewTime)) {
      sendEveningReview_();
      recordReminder_('Evening review', 'EVENING-REVIEW', eveningReviewTime, 'Sent', 1);
    }
    if (isWithinTimeWindow_('09:00')) sendOverdueTaskReminders_(todayKey);
    processUpcomingAppointmentReminders_();
    runRoutineReminderSchedule_('ROUTINE-TRELLO', todayKey, sendTrelloCheckin_);
    runRoutineReminderSchedule_('ROUTINE-OBSIDIAN', todayKey, sendObsidianCheckin_);
    const shutdownTime = String(getSetting_('SHUTDOWN_TIME', '23:00'));
    if (isWithinTimeWindow_(shutdownTime) && !hasReminderFor_('DAILY-SHUTDOWN', todayKey, shutdownTime)) {
      sendShutdownPrompt_();
      recordReminder_('Daily shutdown', 'DAILY-SHUTDOWN', shutdownTime, 'Sent', 1);
    }
    const nextDayPlanningTime = String(getSetting_('NEXT_DAY_PLANNING_TIME', '23:20'));
    if (isWithinTimeWindow_(nextDayPlanningTime) && !hasReminderFor_('NEXT-DAY-PLANNING', todayKey, nextDayPlanningTime)) {
      startNextDayPlanning_();
      recordReminder_('Next-day planning conversation', 'NEXT-DAY-PLANNING', nextDayPlanningTime, 'Sent', 1);
    }
    if (time >= '23:30' && time <= '23:36') {
      ['ROUTINE-TRELLO', 'ROUTINE-OBSIDIAN'].forEach(routineId => {
        if (!getConfirmedRoutine_(routineId, now)) {
          recordRoutineCheckin_(routineId, 'Missed', 'System', 'No routine confirmation recorded by end of day.');
        }
      });
      markIgnoredReminders_(['ROUTINE-TRELLO', 'ROUTINE-OBSIDIAN', 'ROUTINE-DAILY-REVIEW'], todayKey);
    }
    processScheduledFollowups_(now);
    logSystem_('INFO', 'Reminders', 'Cycle', `Reminder cycle completed for ${todayKey}.`);
  } catch (error) {
    logSystem_('ERROR', 'Reminders', 'Cycle', 'Reminder cycle failed.', error);
    throw error;
  }
}

function processUpcomingAppointmentReminders_() {
  const now = now_();
  getCalendarEventsForDate_(now).forEach(event => {
    const minutesUntil = (event.startTime.getTime() - now.getTime()) / 60000;
    if (minutesUntil < 0 || minutesUntil > 15) return;
    const reminderAt = new Date(event.startTime.getTime() - 15 * 60000);
    const rows = getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues();
    const alreadySent = rows.some((row, index) =>
      index > 0 && String(row[2]) === String(event.id) && row[6] === 'Sent' &&
      normalizeDateKey_(row[3]) === dateKey_(reminderAt)
    );
    if (alreadySent) return;
    sendTelegramMessage_(
      `<b>Upcoming appointment</b>\n\n${escapeHtml_(truncateText_(event.title, 160))}\n<b>Starts:</b> ${escapeHtml_(event.start)}`,
      null,
      'Calendar reminder'
    );
    recordReminder_('Calendar appointment', event.id, reminderAt, 'Sent', 1);
  });
}

function markIgnoredReminders_(routineIds, date) {
  const sheet = getSheet_(APP.SHEETS.REMINDER_HISTORY);
  const rows = sheet.getDataRange().getValues();
  rows.forEach((row, index) => {
    if (index === 0 || !routineIds.includes(String(row[2])) ||
        normalizeDateKey_(row[3]) !== date || row[6] !== 'Sent' ||
        ['Confirmed', 'Ignored'].includes(String(row[7]))) return;
    sheet.getRange(index + 1, 8).setValue('Ignored');
  });
}

function runRoutineReminderSchedule_(routineId, todayKey, sendFunction) {
  if (getConfirmedRoutine_(routineId, now_())) return;
  const rows = getSheet_(APP.SHEETS.ROUTINES).getDataRange().getValues();
  const routine = rows.slice(1).find(row => String(row[0]) === routineId);
  if (!routine || routine[4] !== 'Active') return;
  const maximum = Number(routine[6] || getSetting_('MAX_REMINDERS', 3));
  let sentCount = getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues()
    .filter((row, index) => index > 0 && String(row[2]) === routineId &&
      row[3] && normalizeDateKey_(row[3]) === todayKey &&
      (row[6] === 'Sent' || row[6] === 'Scheduled')
    ).length;
  if (sentCount >= maximum) return;
  const scheduledTimes = String(routine[5] || routine[3]).split(',').map(value => value.trim());
  scheduledTimes.forEach(scheduledTime => {
    if (sentCount >= maximum || !isWithinTimeWindow_(scheduledTime) ||
        hasReminderFor_(routineId, todayKey, scheduledTime)) return;
    sendFunction();
    recordReminder_('Routine', routineId, scheduledTime, 'Sent', sentCount + 1);
    sentCount++;
  });
}

function hasReminderFor_(routineId, date, scheduledTime) {
  return getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues().some((row, index) =>
    index > 0 && String(row[2]) === String(routineId) &&
    row[3] && Utilities.formatDate(new Date(row[3]), APP.TIMEZONE, 'yyyy-MM-dd HH:mm') === `${date} ${scheduledTime}`
  );
}

function recordReminder_(category, relatedId, scheduledTime, status, number) {
  const date = dateKey_(now_());
  const time = typeof scheduledTime === 'string' && /^\d{2}:\d{2}$/.test(scheduledTime)
    ? new Date(`${date}T${scheduledTime}:00`)
    : new Date(scheduledTime);
  const sheet = getSheet_(APP.SHEETS.REMINDER_HISTORY);
  const row = [newId_('REM'), category, relatedId, time, now_(), number, status, '', '', ''];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function processScheduledFollowups_(now) {
  const sheet = getSheet_(APP.SHEETS.REMINDER_HISTORY);
  const values = sheet.getDataRange().getValues();
  const sentRoutines = new Set();
  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    if (row[6] !== 'Scheduled' || !row[3] || new Date(row[3]).getTime() > now.getTime()) continue;
    if (sentRoutines.has(String(row[2]))) {
      sheet.getRange(index + 1, 7).setValue('Superseded');
      continue;
    }
    if (now.getTime() - new Date(row[3]).getTime() > 30 * 60000) {
      sheet.getRange(index + 1, 7).setValue('Expired');
      sheet.getRange(index + 1, 8).setValue('Ignored');
      continue;
    }
    if (String(row[2]).startsWith('ROUTINE-') && getConfirmedRoutine_(row[2], now)) {
      sheet.getRange(index + 1, 7).setValue('Cancelled');
      continue;
    }
    if (row[1] === 'Focus sprint' && String(row[2]).startsWith('OUTCOME|')) {
      const parts = String(row[2]).split('|');
      if (parts.length !== 3 || !DAILY_OUTCOME_AREAS.includes(parts[2])) {
        sheet.getRange(index + 1, 7).setValue('Failed');
        logSystem_('ERROR', 'Reminders', 'Invalid focus reminder', 'A focus reminder has an invalid outcome reference.', null, row[0]);
        continue;
      }
      sendOutcomeFollowup_(parts[1], parts[2]);
    } else if (row[2] === 'ROUTINE-DAILY-PLAN') {
      sendDailyPlanningPrompt_();
    } else if (row[2] === 'ROUTINE-TRELLO') {
      sendTrelloCheckin_();
    } else if (row[2] === 'ROUTINE-OBSIDIAN') {
      sendObsidianCheckin_();
    } else {
      continue;
    }
    sheet.getRange(index + 1, 5).setValue(now);
    sheet.getRange(index + 1, 7).setValue('Sent');
    sentRoutines.add(String(row[2]));
    logSystem_('INFO', 'Reminders', 'Follow-up sent', `Follow-up sent for ${row[2]}.`, null, row[0]);
  }
}

function sendOverdueTaskReminders_(todayKey) {
  const overdue = getOverdueTasks_();
  overdue.forEach(task => {
    const history = getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues();
    const reminderNumber = history.slice(1).filter(row =>
      String(row[2]) === String(task[0]) && row[1] === 'Overdue task'
    ).length + 1;
    const alreadySent = history.some((row, index) =>
      index > 0 && String(row[2]) === String(task[0]) && row[4] &&
      dateKey_(row[4]) === todayKey && row[6] === 'Sent'
    );
    if (alreadySent) return;
    const keyboard = reminderNumber === 1
      ? [[
          { text: 'Done', callback_data: `task_complete|${task[1]}` },
          { text: 'Postpone +1 day', callback_data: `task_postpone|${task[1]}|${addDaysDateKey_(1)}` }
        ], [{ text: 'View details', callback_data: `task_details|${task[1]}` }]]
      : reminderNumber === 2
        ? [[
            { text: 'Reschedule', callback_data: `task_reschedule|${task[1]}` },
            { text: 'Mark blocked', callback_data: `task_block|${task[1]}` }
          ], [{ text: 'Done', callback_data: `task_complete|${task[1]}` }]]
        : [[
            { text: 'Reschedule', callback_data: `task_reschedule|${task[1]}` },
            { text: 'Reduce scope', callback_data: `task_reduce|${task[1]}` }
          ], [{ text: 'Mark blocked', callback_data: `task_block|${task[1]}` }]];
    sendTelegramMessage_(
      `<b>${reminderNumber === 1 ? 'A helpful nudge' : reminderNumber === 2 ? 'Choose a next step' : 'Final reminder — make a decision'}</b>\n\n` +
        `<b>${escapeHtml_(task[2])}</b>\nDue: ${escapeHtml_(task[7])}\n\n` +
        (reminderNumber >= 3
          ? 'Please reschedule it, reduce its scope, or record what is blocking it.'
          : 'This is still open. Choose the most useful honest next step.'),
      keyboard,
      'Overdue task reminder',
      { taskId: task[0] }
    );
    recordReminder_('Overdue task', task[0], now_(), 'Sent', reminderNumber);
    updateTaskLastReminder_(task[0]);
  });
}

function updateTaskLastReminder_(taskRecordId) {
  const sheet = getSheet_(APP.SHEETS.TASKS);
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((row, rowIndex) =>
    rowIndex > 0 && String(row[0]) === String(taskRecordId)
  );
  if (index > 0) sheet.getRange(index + 1, 12).setValue(now_());
}

function sendEveningReview_() {
  const key = dateKey_(now_());
  const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1)
    .filter(row => row[7] && dateKey_(row[7]) === key && row[4] !== 'Cancelled' && row[4] !== 'Deleted');
  const completed = rows.filter(row => row[4] === 'Completed').length;
  const pending = rows.filter(row => row[4] === 'Pending').length;
  const postponed = rows.filter(row => Number(row[10] || 0) > 0).length;
  const score = calculateAccountabilityScore_(now_());
  const planned = getConfirmedRoutine_('ROUTINE-DAILY-PLAN', now_());
  const overdue = getOverdueTasks_();
  const details = rows.length
    ? rows.slice(0, 12).map(row => `${row[4] === 'Completed' ? '✓' : '•'} ${escapeHtml_(truncateText_(row[2], 140))}`).join('\n')
    : 'No tasks were scheduled today.';
  const overdueText = overdue.length
    ? overdue.slice(0, 8).map(row => `• ${escapeHtml_(truncateText_(row[2], 140))}`).join('\n')
    : 'None';
  sendTelegramMessage_(
    `<b>Evening review</b>\n\n${details}\n\n<b>Completed / incomplete:</b> ${completed} / ${pending}\n<b>Postponed:</b> ${postponed}\n<b>Overdue tasks:</b>\n${overdueText}\n<b>Planning:</b> ${planned ? 'Confirmed' : 'Not confirmed'}\n<b>Accountability:</b> ${score === '' ? 'Not enough confirmed activity' : `${score} — ${getAccountabilityRating_(score)}`}`,
    [
      [{ text: 'Calendar followed / rescheduled', callback_data: 'calendar_confirm' }],
      [{ text: 'Complete daily review', callback_data: 'daily_review_confirm' }]
    ],
    'Evening review'
  );
}

function startWorkBriefing_() {
  const chatId = requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID);
  setTelegramConversation_(chatId, { type: 'work_briefing_target', date: dateKey_(now_()) });
  sendForceReply_('<b>14:15 work pre-shift</b>\n\nWhat is your SDR target for this shift?', 'Work briefing');
}

function sendShutdownPrompt_() {
  const outcomes = getDailyOutcomes_(now_());
  const status = outcomes.filter(row => row && ['Completed', 'Partial', 'Blocked'].includes(String(row[5])))
    .map(row => `• ${row[1]} — ${escapeHtml_(row[5])}`).join('\n') || 'No outcomes closed yet.';
  sendTelegramMessage_(
    `<b>23:00 shutdown</b>\n\n<b>Outcome check</b>\n${status}\n\nCapture open loops in Google Tasks, or confirm there are none. Tomorrow’s guided planning starts at 23:20.`,
    [
      [getAddTaskButton_()],
      [{ text: 'No open loops now', callback_data: 'shutdown_done' }]
    ],
    'Daily shutdown'
  );
}

function sendOutcomeFollowup_(date, area) {
  const outcomeDate = Utilities.parseDate(`${date} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
  const outcome = getDailyOutcomes_(outcomeDate).find(row => row && row[1] === area);
  if (!outcome) return;
  sendTelegramMessage_(
    `<b>${area} outcome is still open.</b>\n\n${escapeHtml_(truncateText_(outcome[2], 180))}\n\nChoose the honest next step.`,
    [
      [
        { text: 'Done', callback_data: `outcome_status|${date}|${area}|Completed` },
        { text: 'Partly done', callback_data: `outcome_status|${date}|${area}|Partial` }
      ],
      [
        { text: 'Blocked', callback_data: `outcome_status|${date}|${area}|Blocked` },
        { text: 'Reschedule', callback_data: `outcome_reschedule|${date}|${area}` }
      ],
      [
        { text: 'Reduce scope', callback_data: `outcome_reduce|${date}|${area}` },
        { text: 'Drop with reason', callback_data: `outcome_drop|${date}|${area}` }
      ]
    ],
    'Focus block follow-up',
    { taskId: outcome[4] }
  );
}

function runDailyReview() {
  return withScriptLock_(() => runDailyReview_());
}

function runDailyReview_() {
  try {
    syncGoogleTasks();
    const date = now_();
    const key = dateKey_(date);
    const taskRows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1)
      .filter(row => row[7] && dateKey_(row[7]) === key && row[4] !== 'Cancelled' && row[4] !== 'Deleted');
    const completed = taskRows.filter(row => row[4] === 'Completed').length;
    const postponed = taskRows.filter(row => Number(row[10] || 0) > 0).length;
    const score = calculateAccountabilityScore_(date);
    const review = getSheet_(APP.SHEETS.DAILY_REVIEWS);
    const values = review.getDataRange().getValues();
    const index = values.findIndex((row, rowIndex) => rowIndex > 0 && String(row[0]) === key);
    const row = [
      key,
      taskRows.length,
      completed,
      taskRows.length - completed,
      postponed,
      getOverdueTasks_().length,
      getConfirmedRoutine_('ROUTINE-DAILY-PLAN', date),
      getConfirmedRoutine_('ROUTINE-TRELLO', date),
      getConfirmedRoutine_('ROUTINE-OBSIDIAN', date),
      getConfirmedRoutine_('ROUTINE-DAILY-REVIEW', date),
      score,
      `Score: ${score === '' ? 'not available' : score}; calculated from confirmed activities only.`
    ];
    if (index > 0) review.getRange(index + 1, 1, 1, row.length).setValues([row]);
    else review.getRange(review.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    if (!getConfirmedRoutine_('ROUTINE-DAILY-REVIEW', date)) {
      recordRoutineCheckin_('ROUTINE-DAILY-REVIEW', 'Missed', 'System', 'No daily review confirmation.');
    }
    logSystem_('INFO', 'Daily review', 'Completed', `Daily review generated for ${key}.`);
  } catch (error) {
    logSystem_('ERROR', 'Daily review', 'Failed', 'Daily review generation failed.', error);
    throw error;
  }
}
