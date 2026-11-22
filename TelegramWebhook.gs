function doPost(e) {
  let update;
  try {
    const expectedSecret = requireConfig_('WEBHOOK_SECRET');
    const suppliedSecret = e && e.parameter ? e.parameter.key : '';
    if (!suppliedSecret || suppliedSecret !== expectedSecret) {
      logSystem_('WARNING', 'Telegram webhook', 'Rejected request', 'Webhook secret did not match.');
      return ContentService.createTextOutput('Unauthorized');
    }

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Webhook request did not contain a payload.');
    }
    update = JSON.parse(e.postData.contents);
    if (update.update_id != null && !claimWebhookUpdate_(update.update_id)) {
      return ContentService.createTextOutput('Duplicate');
    }

    if (update.callback_query) {
      handleTelegramCallback_(update.callback_query);
    } else if (update.message) {
      handleTelegramMessage_(update.message);
    } else {
      logSystem_('INFO', 'Telegram webhook', 'Ignored update', 'Webhook update type is not handled.');
    }
    return ContentService.createTextOutput('OK');
  } catch (error) {
    logSystem_('ERROR', 'Telegram webhook', 'Request failed', 'Webhook request could not be processed.', error);
    if (update && update.message && update.message.from &&
        isAuthorizedTelegramUser_(update.message.from.id)) {
      try {
        sendTelegramMessage_(
          '<b>That request could not be completed.</b>\n\nCheck the command format or try again. The error has been logged.',
          null,
          'Request failure'
        );
      } catch (deliveryError) {
        logSystem_('ERROR', 'Telegram webhook', 'Failure notice', 'Could not send request failure feedback.', deliveryError);
      }
    }
    return ContentService.createTextOutput('Error');
  }
}

function claimWebhookUpdate_(updateId) {
  return withScriptLock_(() => {
    const cache = CacheService.getScriptCache();
    const key = `telegram-update:${updateId}`;
    if (cache.get(key)) return false;
    cache.put(key, '1', 21600);
    return true;
  });
}
