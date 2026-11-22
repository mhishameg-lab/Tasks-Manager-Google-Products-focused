const DAILY_OUTCOME_AREAS = ['DEEP', 'WORK', 'LIFE'];
const TASK_AREAS = ['DEEP', 'WORK', 'LIFE', 'Admin', 'Other'];

function getDailyOutcomes_(date) {
  const key = dateKey_(date);
  const sheet = getSheet_(APP.SHEETS.DAILY_OUTCOMES);
  const rows = sheet.getDataRange().getValues();
  const latest = {};
  rows.slice(1).forEach(row => {
    if (normalizeDateKey_(row[0]) === key && DAILY_OUTCOME_AREAS.includes(String(row[1]))) {
      latest[String(row[1])] = row;
    }
  });
  return DAILY_OUTCOME_AREAS.map(area => latest[area] || null);
}

function appendDailyOutcome_(date, area, outcome, doneTest, taskId, status, calendarEventId, blockStart, blockEnd, details) {
  if (!DAILY_OUTCOME_AREAS.includes(String(area))) {
    throw new Error('Daily outcome area must be DEEP, WORK, or LIFE.');
  }
  if (!String(outcome || '').trim()) throw new Error('Outcome is required.');

  const existing = getDailyOutcomes_(date).find(row => row && String(row[1]) === String(area));
  const row = [
    dateKey_(date),
    area,
    String(outcome).trim(),
    String(doneTest || ''),
    String(taskId || ''),
    status || 'Planned',
    String(calendarEventId || existing && existing[6] || ''),
    blockStart || existing && existing[7] || '',
    blockEnd || existing && existing[8] || '',
    String(details || ''),
    now_(),
    newId_('OUTCOME')
  ];
  const sheet = getSheet_(APP.SHEETS.DAILY_OUTCOMES);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return row;
}

function updateDailyOutcomeStatus_(date, area, status, details, replacementOutcome, calendarEventId, blockStart, blockEnd) {
  const existing = getDailyOutcomes_(date).find(row => row && String(row[1]) === String(area));
  if (!existing) throw new Error(`No ${area} outcome is set for ${dateKey_(date)}.`);
  return appendDailyOutcome_(
    date,
    area,
    replacementOutcome || existing[2],
    existing[3],
    existing[4],
    status,
    calendarEventId || existing[6],
    blockStart || existing[7],
    blockEnd || existing[8],
    details || ''
  );
}

function renderDailyOutcomes_(date) {
  return getDailyOutcomes_(date).map((row, index) => {
    const area = DAILY_OUTCOME_AREAS[index];
    const text = row ? escapeHtml_(truncateText_(row[2], 180)) : '<i>Not set yet</i>';
    const status = row && row[5] && row[5] !== 'Planned' ? ` <i>(${escapeHtml_(row[5])})</i>` : '';
    return `${index + 1}. <b>${area}</b> — ${text}${status}`;
  }).join('\n');
}

function appendReviewNote_(reviewType, reviewDate, question, answer, relatedArea) {
  const sheet = getSheet_(APP.SHEETS.REVIEW_NOTES);
  const row = [
    newId_('NOTE'),
    reviewType,
    dateKey_(reviewDate),
    question,
    String(answer || '').trim(),
    relatedArea || '',
    now_()
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}
