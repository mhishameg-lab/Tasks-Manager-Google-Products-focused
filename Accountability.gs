function getConfirmedRoutine_(routineId, date) {
  const dateKey = dateKey_(date);
  return getSheet_(APP.SHEETS.CHECKINS).getDataRange().getValues().some((row, index) =>
    index > 0 && String(row[1]) === routineId &&
    normalizeDateKey_(row[2]) === dateKey && String(row[3]) === 'Completed'
  );
}

function calculateAccountabilityScore_(date) {
  const dayKey = dateKey_(date);
  const tasks = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1)
    .filter(row => row[7] && dateKey_(row[7]) === dayKey && row[4] !== 'Cancelled' && row[4] !== 'Deleted');
  const checks = [
    {
      key: 'TASK_COMPLETION_WEIGHT',
      value: tasks.length ? tasks.filter(row => row[4] === 'Completed').length / tasks.length : null
    },
    { key: 'CALENDAR_ADHERENCE_WEIGHT', value: getConfirmedRoutine_('ROUTINE-CALENDAR', date) ? 1 : null },
    { key: 'TRELLO_WEIGHT', value: getConfirmedRoutine_('ROUTINE-TRELLO', date) ? 1 : null },
    { key: 'OBSIDIAN_WEIGHT', value: getConfirmedRoutine_('ROUTINE-OBSIDIAN', date) ? 1 : null },
    {
      key: 'PLANNING_REVIEW_WEIGHT',
      value: (() => {
        const plan = getConfirmedRoutine_('ROUTINE-DAILY-PLAN', date);
        const review = getConfirmedRoutine_('ROUTINE-DAILY-REVIEW', date);
        return plan || review ? (Number(plan) + Number(review)) / 2 : null;
      })()
    }
  ];
  let totalWeight = 0;
  let weightedScore = 0;
  checks.forEach(metric => {
    if (metric.value == null) return;
    const weight = Number(getSetting_(metric.key, 0));
    if (weight > 0) {
      totalWeight += weight;
      weightedScore += weight * metric.value;
    }
  });
  return totalWeight ? Math.round((weightedScore / totalWeight) * 100) : '';
}

function getAccountabilityRating_(score) {
  if (score === '' || score == null) return 'Not enough confirmed activity';
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Needs improvement';
  if (score >= 40) return 'Poor';
  return 'Serious attention required';
}
