function getReportMetrics_(startDate, endDate) {
  const start = dateKey_(startDate);
  const end = dateKey_(endDate);
  const tasks = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1);
  const history = getSheet_(APP.SHEETS.TASK_HISTORY).getDataRange().getValues().slice(1);
  const checkins = getSheet_(APP.SHEETS.CHECKINS).getDataRange().getValues().slice(1);
  const reminders = getSheet_(APP.SHEETS.REMINDER_HISTORY).getDataRange().getValues().slice(1);
  const dailyReviews = getSheet_(APP.SHEETS.DAILY_REVIEWS).getDataRange().getValues().slice(1)
    .filter(row => normalizeDateKey_(row[0]) >= start && normalizeDateKey_(row[0]) <= end);
  const periodTasks = tasks.filter(row => {
    const created = row[6] ? dateKey_(row[6]) : '';
    const completed = row[8] ? dateKey_(row[8]) : '';
    const due = row[7] ? dateKey_(row[7]) : '';
    return (created >= start && created <= end) ||
      (completed >= start && completed <= end) ||
      (due >= start && due <= end);
  });
  const periodHistory = history.filter(row => {
    const stamp = row[7] ? dateKey_(row[7]) : '';
    return stamp >= start && stamp <= end && String(row[5]).toLowerCase().includes('postpon');
  });
  const periodCheckins = checkins.filter(row =>
    normalizeDateKey_(row[2]) >= start && normalizeDateKey_(row[2]) <= end
  );
  const periodReminders = reminders.filter(row =>
    row[4] && normalizeDateKey_(row[4]) >= start && normalizeDateKey_(row[4]) <= end
  );
  const routineNames = {
    'ROUTINE-DAILY-PLAN': 'Daily planning',
    'ROUTINE-DAILY-REVIEW': 'Daily review',
    'ROUTINE-TRELLO': 'Trello updates',
    'ROUTINE-OBSIDIAN': 'Obsidian updates',
    'ROUTINE-CALENDAR': 'Calendar adherence'
  };
  const confirmedRate = routineId => {
    const days = new Set(periodCheckins
      .filter(row => String(row[1]) === routineId && String(row[3]) === 'Completed')
      .map(row => normalizeDateKey_(row[2])));
    return Math.round((days.size / Math.max(1, countDays_(startDate, endDate))) * 100);
  };
  const scored = dailyReviews.map(row => Number(row[10])).filter(value => Number.isFinite(value));
  const overdue = periodTasks.filter(row => row[4] === 'Pending' && row[7] && dateKey_(row[7]) < end).length;
  const workloadThreshold = Number(getSetting_('DAILY_WORKLOAD_THRESHOLD', 8));
  const taskLoadByDay = {};
  periodTasks.forEach(row => {
    if (!row[7] || row[4] === 'Cancelled' || row[4] === 'Deleted') return;
    const day = dateKey_(row[7]);
    if (day >= start && day <= end) taskLoadByDay[day] = (taskLoadByDay[day] || 0) + 1;
  });
  const workloadDays = Object.keys(taskLoadByDay)
    .filter(day => taskLoadByDay[day] > workloadThreshold)
    .map(day => `${day} (${taskLoadByDay[day]} tasks)`);
  return {
    start,
    end,
    created: periodTasks.filter(row => row[6] && dateKey_(row[6]) >= start && dateKey_(row[6]) <= end).length,
    completed: periodTasks.filter(row => row[4] === 'Completed' && row[8] && dateKey_(row[8]) >= start && dateKey_(row[8]) <= end).length,
    incomplete: periodTasks.filter(row => row[4] === 'Pending').length,
    overdue,
    postponements: periodHistory.length,
    planning: confirmedRate('ROUTINE-DAILY-PLAN'),
    trello: confirmedRate('ROUTINE-TRELLO'),
    obsidian: confirmedRate('ROUTINE-OBSIDIAN'),
    calendar: confirmedRate('ROUTINE-CALENDAR'),
    ignoredReminders: periodReminders.filter(row => row[7] === 'Ignored').length,
    workloadDays,
    averageScore: scored.length ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length) : '',
    repeatedProblems: periodTasks.filter(row => Number(row[10] || 0) >= 3).map(row => row[2]).slice(0, 5),
    missedResponsibilities: Array.from(new Set(periodCheckins
      .filter(row => row[3] === 'Missed')
      .map(row => routineNames[row[1]] || row[1])))
  };
}

function countDays_(start, end) {
  return Math.max(1, Math.round((new Date(`${dateKey_(end)}T12:00:00`) - new Date(`${dateKey_(start)}T12:00:00`)) / 86400000) + 1);
}

function getWeekRange_(date) {
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

function buildWeeklyReport_() {
  syncGoogleTasks();
  const range = getWeekRange_(now_());
  const metrics = getReportMetrics_(range.start, range.end);
  const text = `<b>Weekly productivity report</b>\n${metrics.start} to ${metrics.end}\n\n` +
    `<b>Tasks created/completed:</b> ${metrics.created} / ${metrics.completed}\n` +
    `<b>Incomplete / overdue:</b> ${metrics.incomplete} / ${metrics.overdue}\n` +
    `<b>Postponements:</b> ${metrics.postponements}\n` +
    `<b>Planning consistency:</b> ${metrics.planning}%\n` +
    `<b>Trello / Obsidian consistency:</b> ${metrics.trello}% / ${metrics.obsidian}%\n` +
    `<b>Calendar check-ins:</b> ${metrics.calendar}%\n` +
    `<b>Ignored reminders:</b> ${metrics.ignoredReminders}\n` +
    `<b>Average accountability score:</b> ${metrics.averageScore === '' ? 'Not available' : metrics.averageScore}\n\n` +
    '<b>Scoring:</b> weighted confirmed activity only; unavailable categories are excluded and remaining configured weights are normalized.\n' +
    `<b>Repeated postponements:</b> ${metrics.repeatedProblems.length ? metrics.repeatedProblems.map(escapeHtml_).join(', ') : 'None identified'}\n` +
    `<b>Missed responsibilities:</b> ${metrics.missedResponsibilities.length ? metrics.missedResponsibilities.map(escapeHtml_).join(', ') : 'None recorded'}\n` +
    `<b>High-workload days:</b> ${metrics.workloadDays.length ? metrics.workloadDays.join(', ') : 'None'}\n` +
    '<b>Recommendation:</b> carry forward only the highest-priority unfinished tasks and review repeated delays.';
  saveReview_(APP.SHEETS.WEEKLY_REVIEWS, metrics, 'week');
  return { metrics, text };
}

function buildMonthlyReport_() {
  syncGoogleTasks();
  const today = now_();
  const isFirstOfMonth = Number(Utilities.formatDate(today, APP.TIMEZONE, 'd')) === 1;
  const start = isFirstOfMonth
    ? new Date(today.getFullYear(), today.getMonth() - 1, 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const end = isFirstOfMonth
    ? new Date(today.getFullYear(), today.getMonth(), 0)
    : today;
  const metrics = getReportMetrics_(start, end);
  const rate = metrics.completed + metrics.incomplete
    ? Math.round(100 * metrics.completed / Math.max(1, metrics.completed + metrics.incomplete))
    : 0;
  const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const previousEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  const previousMetrics = getReportMetrics_(previousStart, previousEnd);
  const weeklyScores = getSheet_(APP.SHEETS.WEEKLY_REVIEWS).getDataRange().getValues().slice(1)
    .filter(row => normalizeDateKey_(row[0]) >= metrics.start && normalizeDateKey_(row[0]) <= metrics.end && row[8] !== '')
    .map(row => `${normalizeDateKey_(row[0])}: ${row[8]}`);
  const previousRate = previousMetrics.completed + previousMetrics.incomplete
    ? Math.round(100 * previousMetrics.completed / Math.max(1, previousMetrics.completed + previousMetrics.incomplete))
    : 0;
  const improvement = rate - previousRate;
  const improvementText = `${improvement >= 0 ? '+' : ''}${improvement} percentage points vs. prior month`;
  const text = `<b>Monthly productivity report</b>\n${metrics.start} to ${metrics.end}\n\n` +
    `<b>Created / completed:</b> ${metrics.created} / ${metrics.completed}\n` +
    `<b>Completion rate:</b> ${rate}%\n<b>Incomplete / overdue:</b> ${metrics.incomplete} / ${metrics.overdue}\n` +
    `<b>Postponements:</b> ${metrics.postponements}\n<b>Planning consistency:</b> ${metrics.planning}%\n` +
    `<b>Trello / Obsidian:</b> ${metrics.trello}% / ${metrics.obsidian}%\n` +
    `<b>Ignored reminders:</b> ${metrics.ignoredReminders}\n` +
    `<b>Average accountability score:</b> ${metrics.averageScore === '' ? 'Not available' : metrics.averageScore}\n\n` +
    `<b>Weekly scores:</b> ${weeklyScores.length ? weeklyScores.join(', ') : 'Not available'}\n` +
    `<b>Month-over-month completion change:</b> ${improvementText}\n` +
    '<b>Scoring:</b> only recorded confirmations and completed tasks count; unavailable categories are excluded.\n' +
    `<b>Responsibilities needing attention:</b> ${metrics.repeatedProblems.length ? metrics.repeatedProblems.map(escapeHtml_).join(', ') : 'No repeated postponements identified'}\n` +
    `<b>High-workload days:</b> ${metrics.workloadDays.length ? metrics.workloadDays.join(', ') : 'None'}\n` +
    `<b>Missed responsibilities:</b> ${metrics.missedResponsibilities.length ? metrics.missedResponsibilities.map(escapeHtml_).join(', ') : 'None recorded'}\n` +
    '<b>Recommendation:</b> reduce carry-forward work and reserve time for recurring responsibilities.\n' +
    '<b>Project decisions:</b> continue, change approach, pause, or kill; record the reason and a review date.';
  metrics.improvements = improvementText;
  saveReview_(APP.SHEETS.MONTHLY_REVIEWS, metrics, 'month');
  return { metrics, text };
}

function saveReview_(sheetName, metrics, period) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const key = period === 'week' ? metrics.start : metrics.start.slice(0, 7);
  const keyColumn = 0;
  const index = values.findIndex((row, rowIndex) => rowIndex > 0 &&
    (period === 'week' ? normalizeDateKey_(row[keyColumn]) : String(row[keyColumn])) === key
  );
  const row = period === 'week'
    ? [metrics.start, metrics.created, metrics.completed, metrics.overdue, metrics.postponements, metrics.planning, metrics.trello, metrics.obsidian, metrics.averageScore, metrics.repeatedProblems.join(', '), 'Prioritize overdue and repeatedly postponed tasks.']
    : [key, metrics.created, metrics.completed, metrics.completed + metrics.incomplete ? metrics.completed / (metrics.completed + metrics.incomplete) : 0, metrics.overdue, metrics.postponements, metrics.planning, metrics.trello, metrics.obsidian, metrics.averageScore, metrics.repeatedProblems.join(', '), metrics.improvements || '', 'Review recurring delays and adjust workload.'];
  if (index > 0) {
    sheet.getRange(index + 1, 1, 1, row.length).setValues([row]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  }
}
