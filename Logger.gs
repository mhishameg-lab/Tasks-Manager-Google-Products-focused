function logSystem_(severity, component, eventType, description, error, relatedRecordId) {
  const sheet = getSheet_(APP.SHEETS.SYSTEM_LOGS);
  const errorMessage = error ? redactSensitiveText_(error.message || error) : '';
  const stack = error && error.stack ? redactSensitiveText_(error.stack) : '';
  const row = [
    newId_('LOG'),
    now_(),
    severity || 'INFO',
    component || 'System',
    eventType || 'Event',
    redactSensitiveText_(description || ''),
    '',
    relatedRecordId || '',
    errorMessage,
    stack
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function logSync_(source, operation, result, errorDetails, retryCount, relatedRecordId) {
  const sheet = getSheet_(APP.SHEETS.SYNC_LOGS);
  const row = [
    newId_('SYNC'),
    source,
    operation,
    now_(),
    result,
    redactSensitiveText_(errorDetails || ''),
    Number(retryCount || 0),
    relatedRecordId || ''
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}
