function doPost(e) {
  let claimedUpdateId = null;
  try {
    const expectedSecret = requireConfig_(APP.PROPERTIES.WEBHOOK_SECRET);
    const providedSecret = e && e.parameter ? e.parameter.key : '';
    if (!providedSecret || providedSecret !== expectedSecret) {
      logSystem_('WARNING', 'Telegram webhook', 'Rejected request', 'Webhook authentication failed.');
      return webhookTextResponse_('Unauthorized');
    }

    const content = e && e.postData ? e.postData.contents : '';
    if (!content) throw new Error('Telegram webhook request body is empty.');
    const update = JSON.parse(content);
    if (!update || !Number.isSafeInteger(Number(update.update_id))) {
      throw new Error('Telegram webhook update_id is missing or invalid.');
    }
    claimedUpdateId = Number(update.update_id);
    if (!claimTelegramUpdate_(claimedUpdateId)) {
      return webhookTextResponse_('Duplicate');
    }

    withScriptLock_(() => {
      if (update.callback_query) {
        processTelegramCallback_(update.callback_query);
      } else if (update.message) {
        handleTelegramMessage_(update.message);
      } else {
        logSystem_('INFO', 'Telegram webhook', 'Ignored update', 'Update type is not handled.');
      }
    }, 5000);
    return webhookTextResponse_('OK');
  } catch (error) {
    if (claimedUpdateId !== null) {
      CacheService.getScriptCache().remove(`TELEGRAM_UPDATE_${claimedUpdateId}`);
    }
    try {
      logSystem_('ERROR', 'Telegram webhook', 'Request failed', 'Could not process a Telegram webhook update.', error);
    } catch (loggingError) {
      console.error(`Telegram webhook logging failed: ${redactSensitiveText_(loggingError.message)}`);
    }
    return webhookTextResponse_('Error');
  }
}

function claimTelegramUpdate_(updateId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) throw new Error('Could not acquire the Telegram update lock.');
  try {
    const cache = CacheService.getScriptCache();
    const key = `TELEGRAM_UPDATE_${updateId}`;
    if (cache.get(key)) return false;
    cache.put(key, '1', 21600);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function webhookTextResponse_(text) {
  return ContentService.createTextOutput(String(text || ''));
}
