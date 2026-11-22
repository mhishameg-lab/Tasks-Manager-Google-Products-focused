function now_() {
  return new Date();
}

function addDaysDateKey_(days) {
  const date = new Date(`${dateKey_(now_())}T12:00:00`);
  date.setDate(date.getDate() + Number(days));
  return dateKey_(date);
}

function isValidDateKey_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T12:00:00`);
  return !isNaN(date.getTime()) && dateKey_(date) === value;
}

function normalizeDateKey_(value) {
  if (!value) return '';
  if (value instanceof Date) return dateKey_(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : dateKey_(date);
}

function isWithinTimeWindow_(scheduledTime, toleranceMinutes) {
  const now = Number(Utilities.formatDate(now_(), APP.TIMEZONE, 'HHmm'));
  const parts = String(scheduledTime).split(':').map(Number);
  if (parts.length !== 2 || parts.some(value => !Number.isFinite(value))) return false;
  const scheduled = parts[0] * 60 + parts[1];
  const current = Math.floor(now / 100) * 60 + (now % 100);
  return current >= scheduled && current <= scheduled + Number(toleranceMinutes || 6);
}

function newId_(prefix) {
  return `${prefix}-${Utilities.getUuid()}`;
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateText_(value, maxLength) {
  const text = String(value == null ? '' : value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function getSetting_(key, fallback) {
  const rows = getSheet_(APP.SHEETS.SETTINGS).getDataRange().getValues();
  for (let index = 1; index < rows.length; index++) {
    if (String(rows[index][0]) === key) return rows[index][1];
  }
  return fallback;
}

function withScriptLock_(callback, timeoutMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 20000)) {
    const error = new Error('Another assistant operation is still running. Please retry shortly.');
    logSystem_('WARNING', 'Concurrency', 'Lock unavailable', error.message, error);
    throw error;
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function withSyncLock_(callback, timeoutMs) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(timeoutMs || 20000)) {
    const error = new Error('Google Tasks sync or task update is already running. Please retry shortly.');
    logSystem_('WARNING', 'Google Tasks', 'Lock unavailable', error.message, error);
    throw error;
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function retryTransient_(callback, maxAttempts, onRetry) {
  const attempts = Math.max(1, Number(maxAttempts || 3));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return callback();
    } catch (error) {
      const message = String(error && error.message || error);
      const temporary = error && typeof error.temporary === 'boolean'
        ? error.temporary
        : /\b(429|500|502|503|504)\b|temporar|rate.?limit|internal error|service invoked too many times/i.test(message);
      if (!temporary || attempt === attempts) {
        if (error && typeof error === 'object') error.retryCount = attempt - 1;
        throw error;
      }
      if (onRetry) onRetry(attempt);
      Utilities.sleep(300 * Math.pow(2, attempt - 1));
    }
  }
  throw new Error('Retry operation exited unexpectedly.');
}

function isAuthorizedTelegramUser_(userId) {
  const authorizedId = getConfig_(APP.PROPERTIES.AUTHORIZED_TELEGRAM_USER_ID);
  return Boolean(authorizedId && userId != null && String(userId) === String(authorizedId));
}

function redactSensitiveText_(value) {
  let text = String(value || '')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]');
  ['TELEGRAM_BOT_TOKEN', 'WEBHOOK_SECRET'].forEach(key => {
    const secret = getConfig_(key);
    if (secret) text = text.split(secret).join('[REDACTED]');
  });
  return text;
}
