function handleTelegramMessage_(message) {
  if (isDuplicateTelegramMessage_(message.chat.id, message.message_id)) return;
  const text = (message.text || '').trim();
  const commandMatch = text.match(/^\/([a-z0-9_]+)(?:@\w+)?/i);
  const command = commandMatch ? `/${commandMatch[1].toLowerCase()}` : '';
  const authorized = isAuthorizedTelegramUser_(message.from.id);

  logTelegramMessage_({
    chatId: message.chat.id,
    messageId: message.message_id,
    direction: 'incoming',
    type: text.startsWith('/') ? 'command' : 'message',
    category: 'Telegram command',
    content: redactSensitiveText_(text),
    deliveryStatus: authorized ? 'Received' : 'Rejected'
  });
  if (!authorized) return;
  if (processTelegramConversation_(message)) return;
  if (!command && text) {
    setTelegramConversation_(message.chat.id, { type: 'capture_classification', capture: text });
    sendTelegramMessage_(
      `<b>How should I route this?</b>\n\n${escapeHtml_(truncateText_(text, 240))}\n\nIs it a next action, a project, or an idea?`,
      [[
        { text: 'Next action', callback_data: 'capture_route|action' },
        { text: 'Project', callback_data: 'capture_route|project' },
        { text: 'Idea', callback_data: 'capture_route|idea' }
      ]],
      'Capture classification'
    );
    return;
  }

  switch (command) {
    case '/start':
      sendHomeMenu_('Welcome');
      break;

    case '/help':
      sendHelpControlPanel_();
      break;

    case '/today':
      sendTodayBriefing_();
      break;

    case '/tasks':
      sendTaskList_();
      break;

    case '/tomorrow':
      sendTomorrowPlan_();
      break;

    case '/review':
      sendDailyPlanningPrompt_();
      break;

    case '/overdue':
      syncGoogleTasks();
      if (typeof getOverdueTasks_ !== 'function') {
        sendTelegramMessage_(
          '<b>Overdue Tasks</b>\n\nGoogle Tasks synchronization is not installed yet.',
          null,
          'Overdue tasks'
        );
        return;
      }

      const overdue = getOverdueTasks_();
      const overdueText = overdue.length
        ? overdue.map((task, index) =>
            `${index + 1}. <b>${escapeHtml_(task[2])}</b>\nDue: ${escapeHtml_(task[7] || 'No due date')}`
          ).join('\n\n')
        : 'Excellent — you have no overdue tasks.';

      sendTelegramMessage_(
        `<b>Overdue Tasks</b>\n\n${overdueText}`,
        null,
        'Overdue tasks'
      );
      break;

    case '/habits':
      sendTrelloCheckin_();
      sendObsidianCheckin_();
      break;

    case '/progress':
      sendProgressReport_();
      break;

    case '/weekly':
      sendWeeklyReviewQuestion_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), 0, dateKey_(now_()));
      break;

    case '/monthly':
      sendMonthlyReport_();
      break;

    case '/completed':
      sendCompletedTasks_();
      break;

    case '/postpone':
      handlePostponeCommand_(text);
      break;

    case '/accountability':
      sendAccountabilityStatus_();
      break;

    case '/addtask':
      handleAddTaskCommand_(text);
      break;

    case '/focus':
      beginFocusNow_();
      break;

    case '/capture':
      sendCaptureChoices_();
      break;

    case '/settings':
      sendSettingsPanel_();
      break;

    case '/calendar':
      handleAddCalendarCommand_(text);
      break;

    default:
      sendTelegramMessage_(
        '<b>What do you need?</b>\n\nChoose a useful next step, or use /help for shortcuts.',
        buildControlPanelKeyboard_(),
        'Control panel'
      );
  }
}

function telegramRequest_(method, payload) {
  const token = requireConfig_(APP.PROPERTIES.TELEGRAM_BOT_TOKEN);
  const maxAttempts = 3;
  return retryTransient_(() => {
    let response;
    try {
      response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload || {}),
        muteHttpExceptions: true
      });
    } catch (error) {
      const requestError = new Error(
        method === 'sendMessage'
          ? 'Telegram send request failed before a delivery result was received.'
          : `Telegram request failed: ${redactSensitiveText_(error.message)}`
      );
      requestError.temporary = method !== 'sendMessage';
      throw requestError;
    }
    const code = response.getResponseCode();
    let body;
    try {
      body = JSON.parse(response.getContentText());
    } catch (error) {
      const parseError = new Error(`Telegram ${method} returned an invalid response (${code}).`);
      parseError.temporary = code === 429 || (method !== 'sendMessage' && code >= 500);
      throw parseError;
    }
    if (!body.ok) {
      const apiError = new Error(`Telegram ${method} failed (${code}): ${redactSensitiveText_(body.description || 'Unknown API error')}`);
      apiError.temporary = code === 429 || (method !== 'sendMessage' && code >= 500);
      throw apiError;
    }
    return body.result;
  }, maxAttempts, attempt => logSystem_(
    'WARNING',
    'Telegram',
    'Retry',
    `Retrying Telegram ${method} request (attempt ${attempt + 1}).`
  ));
}

function handleTelegramCallback_(callbackQuery) {
  return withScriptLock_(() => processTelegramCallback_(callbackQuery));
}

function processTelegramCallback_(callbackQuery) {
  const action = callbackQuery.data || '';
  let result = 'Completed';
  let response = '';
  let responseKeyboard = null;
  let actionLogRow;
  let callbackAcknowledged = false;
  let callbackErrorDetails = '';

  try {
    if (typeof isDuplicateCallback_ === 'function' &&
        isDuplicateCallback_(callbackQuery.id)) {
      callbackAcknowledged = acknowledgeTelegramCallback_(
        callbackQuery.id,
        'This action was already processed.'
      );
      return;
    }

    if (!isAuthorizedTelegramUser_(callbackQuery.from.id)) {
      callbackAcknowledged = acknowledgeTelegramCallback_(callbackQuery.id, 'Not authorized.');
      logTelegramAction_({
        telegramUserId: callbackQuery.from.id,
        callbackQueryId: callbackQuery.id,
        buttonIdentifier: action,
        actionName: action,
        actionResult: 'Rejected'
      });
      return;
    }

    actionLogRow = logTelegramAction_({
      telegramUserId: callbackQuery.from.id,
      callbackQueryId: callbackQuery.id,
      buttonIdentifier: action,
      actionName: action,
      actionResult: 'Processing'
    });
    callbackAcknowledged = acknowledgeTelegramCallback_(callbackQuery.id, 'Processing your request…');

    if (action === 'day_start') {
      response =
        '<b>Day started.</b>\n\nFocus on your highest-priority task first. I will keep track of unfinished work and follow up when needed.';
    }

    else if (action === 'home_menu') {
      response = '<b>Good morning.</b>\n\n<b>Your three outcomes</b>\n' +
        renderDailyOutcomes_(now_()) + '\n\nWhat do you want to move forward now?';
      responseKeyboard = [
        [{ text: 'Start DEEP', callback_data: 'outcome_start|DEEP' }, { text: 'Start WORK', callback_data: 'outcome_start|WORK' }],
        [{ text: 'Start LIFE', callback_data: 'outcome_start|LIFE' }],
        [getAddTaskButton_(), { text: 'Show full plan', callback_data: 'home_show_plan' }]
      ];
    }

    else if (action === 'home_show_plan') {
      syncGoogleTasks();
      const tasks = getTasksForDate_(now_());
      const taskText = tasks.length
        ? tasks.slice(0, 10).map(row => `• <b>${escapeHtml_(truncateText_(row[2], 120))}</b>`).join('\n')
        : 'No dated tasks for today.';
      const events = getCalendarEventsForDate_(now_());
      const eventText = events.length
        ? events.map(event => `• ${escapeHtml_(event.start)} ${escapeHtml_(truncateText_(event.title, 90))}`).join('\n')
        : 'No calendar appointments today.';
      response =
        `<b>Today’s full plan</b>\n\n<b>Three outcomes</b>\n${renderDailyOutcomes_(now_())}` +
        `\n\n<b>Tasks</b>\n${taskText}\n\n<b>Calendar</b>\n${eventText}`;
      responseKeyboard = buildControlPanelKeyboard_();
    }

    else if (action === 'plan_my_day') {
      const events = getCalendarEventsForDate_(now_());
      const eventText = events.length
        ? events.map(event => `• ${escapeHtml_(event.start)} ${escapeHtml_(truncateText_(event.title, 90))}`).join('\n')
        : 'No calendar appointments today.';
      response = `<b>Plan today</b>\n\n<b>Your three outcomes</b>\n${renderDailyOutcomes_(now_())}` +
        `\n\n<b>Calendar</b>\n${eventText}\n\nIs this realistic?`;
      responseKeyboard = [
        [{ text: 'Today is planned', callback_data: 'plan_confirm_today' }],
        [getAddTaskButton_(), { text: 'Show full plan', callback_data: 'home_show_plan' }]
      ];
    }

    else if (action === 'focus_now') {
      beginFocusNow_();
      response = '<b>Focus prompt opened.</b>\n\nAnswer with the smallest visible result.';
    }

    else if (action === 'review_progress') {
      const score = calculateAccountabilityScore_(now_());
      const confirmed = score === '' ? 'Not enough confirmed activity' : `${score}/100 — ${getAccountabilityRating_(score)}`;
      response = `<b>Progress</b>\n\n<b>Today’s outcomes</b>\n${renderDailyOutcomes_(now_())}` +
        `\n\n<b>Accountability:</b> ${confirmed}\n\nRescheduling honestly is useful data, not a failure.`;
      responseKeyboard = [[{ text: 'Weekly review', callback_data: 'weekly_start' }, { text: 'Back to home', callback_data: 'home_menu' }]];
    }

    else if (action === 'settings_show') {
      response = '<b>How this system works</b>\n\n' +
        '• Google Tasks — actionable next steps and their status\n' +
        '• Google Calendar — when work and appointments happen\n' +
        '• Trello — projects and stages (manual check-in)\n' +
        '• Obsidian — ideas, decisions, learning, and reflection\n' +
        '• Telegram — capture, planning, focus, and clear decisions\n\nTime zone: Africa/Cairo.';
      responseKeyboard = [[{ text: 'Back to today', callback_data: 'home_show_plan' }]];
    }

    else if (action === 'task_add_help') {
      response = getTaskMiniAppUrl_()
        ? '<b>Open the task form.</b>\n\nChoose the button below to capture an action without a typed format.'
        : '<b>Add a task.</b>\n\nWhat is the next action you want to capture?';
      responseKeyboard = getTaskMiniAppUrl_()
        ? [[{ text: 'Open task form', web_app: { url: getTaskMiniAppUrl_() } }]]
        : null;
      if (!getTaskMiniAppUrl_()) {
        setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), { type: 'task_title' });
        sendForceReply_('<b>What is the next action you want to capture?</b>', 'Task capture');
      }
    }

    else if (action.startsWith('task_due_')) {
      const parts = action.split('|');
      const draftId = parts[1];
      const cache = CacheService.getScriptCache();
      const draftKey = `task-draft:${draftId}`;
      const draftText = cache.get(draftKey);
      if (!draftText) throw new Error('Task draft expired. Please start again.');
      const draft = JSON.parse(draftText);
      const choice = parts[0].replace('task_due_', '');
      if (choice === 'today') draft.dueDate = dateKey_(now_());
      else if (choice === 'tomorrow') draft.dueDate = addDaysDateKey_(1);
      else if (choice === 'week') {
        const remainingDays = (7 - Number(Utilities.formatDate(now_(), APP.TIMEZONE, 'u'))) % 7;
        draft.dueDate = addDaysDateKey_(remainingDays || 7);
      } else if (choice === 'none') draft.dueDate = '';
      else if (choice === 'choose') {
        cache.put(draftKey, JSON.stringify(draft), 3600);
        setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
          type: 'task_due_date', draftId: draftId
        });
        response = '<b>Choose a date.</b>\n\nReply using YYYY-MM-DD.';
        sendForceReply_('What is the due date? YYYY-MM-DD', 'Task due date');
      } else {
        throw new Error('Task due-date choice is invalid.');
      }
      cache.put(draftKey, JSON.stringify(draft), 3600);
      if (choice !== 'choose') {
        setTaskDraftDueDate_(draftId, draft.dueDate, requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID));
        response = '<b>One last detail.</b>\n\nWhat would count as done?';
      }
    }

    else if (action === 'task_due_continue') {
      response = '<b>What would count as done?</b>';
      sendForceReply_('What would count as done?', 'Task done test');
    }

    else if (action.startsWith('outcome_start|')) {
      const parts = action.split('|');
      const date = parts.length === 2 ? dateKey_(now_()) : parts[1];
      const area = parts.length === 2 ? parts[1] : parts[2];
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area)) {
        throw new Error('Outcome selection is invalid.');
      }
      const outcome = getDailyOutcomes_(date).find(row => row && row[1] === area);
      if (outcome) {
        beginOutcomeSprint_(area, date);
        response = '<b>Focus started.</b>\n\nName the smallest visible result you can finish in 25–50 minutes.';
      } else {
        setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
          type: 'outcome_define', area: area, date: date
        });
        response = `<b>Set your ${area} outcome.</b>\n\nWhat does done look like, and when will you do it?`;
        sendForceReply_(`What does done look like for your ${area} outcome today?`, 'Define daily outcome');
      }
    }

    else if (action.startsWith('focus_duration|')) {
      const parts = action.split('|');
      const legacyFormat = parts.length === 3;
      const date = legacyFormat ? dateKey_(now_()) : parts[1];
      const area = legacyFormat ? parts[1] : parts[2];
      const duration = Number(legacyFormat ? parts[2] : parts[3]);
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area) || ![25, 50].includes(duration)) {
        throw new Error('Focus block selection is invalid.');
      }
      const due = new Date(Date.now() + duration * 60000);
      const reminderSheet = getSheet_(APP.SHEETS.REMINDER_HISTORY);
      const relatedId = `OUTCOME|${date}|${area}`;
      const row = [newId_('REM'), 'Focus sprint', relatedId, due, '', 1, 'Scheduled', '', '', due];
      reminderSheet.getRange(reminderSheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
      response = `<b>${duration}-minute focus block started.</b>\n\nI’ll check back around ${Utilities.formatDate(due, APP.TIMEZONE, 'HH:mm')}.`;
      responseKeyboard = [[{ text: 'Back to home', callback_data: 'home_menu' }]];
      clearTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID));
    }

    else if (action.startsWith('outcome_status|')) {
      const parts = action.split('|');
      const legacyFormat = parts.length === 3;
      const date = legacyFormat ? dateKey_(now_()) : parts[1];
      const area = legacyFormat ? parts[1] : parts[2];
      const status = legacyFormat ? parts[2] : parts[3];
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area)) throw new Error('Outcome selection is invalid.');
      const outcome = getDailyOutcomes_(date).find(row => row && row[1] === area);
      if (!outcome) throw new Error(`No ${area} outcome is set for ${date}.`);
      if (!['Completed', 'Partial', 'Blocked'].includes(status)) throw new Error('Outcome status is invalid.');
      if (status === 'Completed' && outcome[4]) {
        const task = getTaskRecordByGoogleId_(outcome[4]);
        if (task && task[4] === 'Pending') completeGoogleTask_(outcome[4]);
      }
      if (status === 'Blocked') {
        response = '<b>Thanks for being honest.</b>\n\nWhat is blocking it?';
        responseKeyboard = [[
          { text: 'Unclear next step', callback_data: `outcome_block_reason|${date}|${area}|unclear` },
          { text: 'Missing information', callback_data: `outcome_block_reason|${date}|${area}|information` }
        ], [
          { text: 'Low energy', callback_data: `outcome_block_reason|${date}|${area}|energy` },
          { text: 'External dependency', callback_data: `outcome_block_reason|${date}|${area}|external` }
        ]];
      } else {
        updateDailyOutcomeStatus_(date, area, status, 'User confirmed focus-block outcome.');
        response = status === 'Completed'
          ? `<b>${area} outcome marked done.</b>\n\nThe confirmation is recorded${outcome[4] ? ' in Google Tasks' : ''}.`
          : `<b>${area} outcome marked partly done.</b>\n\nChoose one useful next step.`;
        responseKeyboard = status === 'Completed'
          ? [[{ text: 'Back to home', callback_data: 'home_menu' }]]
          : [[
              { text: 'Start 25-minute sprint', callback_data: `outcome_start|${date}|${area}` },
              { text: 'Reschedule', callback_data: `outcome_reschedule|${date}|${area}` }
            ], [{ text: 'Mark blocked', callback_data: `outcome_status|${date}|${area}|Blocked` }]];
      }
    }

    else if (action.startsWith('outcome_block_reason|')) {
      const parts = action.split('|');
      const reasons = { unclear: 'Unclear next step', information: 'Missing information', energy: 'Low energy', external: 'External dependency' };
      const legacyFormat = parts.length === 3;
      const date = legacyFormat ? dateKey_(now_()) : parts[1];
      const area = legacyFormat ? parts[1] : parts[2];
      const reason = legacyFormat ? parts[2] : parts[3];
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area) || !reasons[reason]) {
        throw new Error('Blocker reason is invalid.');
      }
      updateDailyOutcomeStatus_(date, area, 'Blocked', reasons[reason]);
      response = `<b>Blocker recorded:</b> ${escapeHtml_(reasons[reason])}\n\nWe can use this in your review.`;
      responseKeyboard = [[
        { text: 'Reduce the scope', callback_data: `outcome_reduce|${date}|${area}` },
        { text: 'Move to a time', callback_data: `outcome_reschedule|${date}|${area}` }
      ], [{ text: 'Drop with reason', callback_data: `outcome_drop|${date}|${area}` }]];
    }

    else if (action.startsWith('outcome_reduce|')) {
      const parts = action.split('|');
      const date = parts.length === 2 ? dateKey_(now_()) : parts[1];
      const area = parts.length === 2 ? parts[1] : parts[2];
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area)) throw new Error('Outcome selection is invalid.');
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'outcome_reduce', area: area, date: date
      });
      response = '<b>Reduce the scope.</b>\n\nReply with a smaller visible result you can finish.';
      sendForceReply_('What is the smaller visible result?', 'Reduce outcome scope');
    }

    else if (action.startsWith('outcome_reschedule|')) {
      const parts = action.split('|');
      const date = parts.length === 2 ? dateKey_(now_()) : parts[1];
      const area = parts.length === 2 ? parts[1] : parts[2];
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area)) throw new Error('Outcome selection is invalid.');
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'outcome_reschedule', area: area, date: date
      });
      response = '<b>Choose a specific time.</b>\n\nReply with Cairo local time as YYYY-MM-DD HH:mm. I’ll create a 25-minute Calendar block after your answer.';
      sendForceReply_('What date and time should I move this to? YYYY-MM-DD HH:mm', 'Reschedule outcome');
    }

    else if (action.startsWith('outcome_drop|')) {
      const parts = action.split('|');
      const date = parts.length === 2 ? dateKey_(now_()) : parts[1];
      const area = parts.length === 2 ? parts[1] : parts[2];
      if (!isValidDateKey_(date) || !DAILY_OUTCOME_AREAS.includes(area)) throw new Error('Outcome selection is invalid.');
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'outcome_drop', area: area, date: date
      });
      response = '<b>Drop this outcome.</b>\n\nReply with a short reason. The related Google Task will remain pending.';
      sendForceReply_('Why are you dropping this outcome?', 'Drop outcome reason');
    }

    else if (action === 'capture_project') {
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), { type: 'project_capture' });
      response = '<b>Capture a project.</b>\n\nReply with its name or link. Keep project stages in Trello.';
      sendForceReply_('What project should you update in Trello?', 'Project capture');
    }

    else if (action.startsWith('capture_route|')) {
      const route = action.split('|')[1];
      const chatId = requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID);
      const stateKey = `telegram-conversation:${chatId}`;
      const stateText = CacheService.getScriptCache().get(stateKey);
      if (!stateText) throw new Error('Capture choice expired. Please send it again.');
      const state = JSON.parse(stateText);
      if (state.type !== 'capture_classification' || !state.capture) {
        throw new Error('There is no captured item to route.');
      }
      clearTelegramConversation_(chatId);
      if (route === 'action') {
        beginTaskCapture_(chatId, state.capture);
        response = '<b>Next action selected.</b>\n\nChoose a due date and then define what done looks like.';
      } else if (route === 'project') {
        response = `<b>Project belongs in Trello.</b>\n\n${escapeHtml_(state.capture)}\n\nAdd or update it manually in Trello; I do not write to Trello.`;
        responseKeyboard = [[{ text: 'Back to home', callback_data: 'home_menu' }]];
      } else if (route === 'idea') {
        response = `<b>Idea captured in this chat.</b>\n\n${escapeHtml_(state.capture)}\n\nAdd it manually to your Obsidian Inbox or Someday list; I do not write to Obsidian.`;
        responseKeyboard = [[{ text: 'Back to home', callback_data: 'home_menu' }]];
      } else {
        throw new Error('Capture route is invalid.');
      }
    }

    else if (action === 'capture_idea') {
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), { type: 'idea_capture' });
      response = '<b>Capture an idea.</b>\n\nReply with the idea; then add it manually to your Obsidian Inbox or Someday list.';
      sendForceReply_('What idea do you want to remember?', 'Idea capture');
    }

    else if (action === 'capture_next_action') {
      response = '<b>Capture a next action.</b>\n\nUse the task form or start with a short sentence.';
      if (getTaskMiniAppUrl_()) {
        responseKeyboard = [[{ text: 'Open task form', web_app: { url: getTaskMiniAppUrl_() } }]];
      } else {
        setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), { type: 'task_title' });
        sendForceReply_('What is the next action you want to capture?', 'Task capture');
      }
    }

    else if (action === 'weekly_start') {
      sendWeeklyReviewQuestion_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), 0, dateKey_(now_()));
      response = '<b>Weekly review started.</b>\n\nI’ll keep it to one question at a time.';
    }

    else if (action === 'monthly_project_review') {
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'monthly_project_name', date: dateKey_(now_())
      });
      response = '<b>Monthly project decision.</b>\n\nWhich project needs a continue, change, pause, or kill decision?';
      sendForceReply_('What is the project name?', 'Monthly review');
    }

    else if (action.startsWith('monthly_decision|')) {
      const decision = action.split('|')[1];
      const cache = CacheService.getScriptCache();
      const stateKey = `telegram-conversation:${requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID)}`;
      const stateText = cache.get(stateKey);
      if (!stateText) throw new Error('Monthly project review expired; start it again.');
      const state = JSON.parse(stateText);
      if (state.type !== 'monthly_project_decision' || !['continue', 'change', 'pause', 'kill'].includes(decision)) {
        throw new Error('Monthly project decision is invalid.');
      }
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'monthly_project_reason', date: state.date, project: state.project, decision: decision
      });
      response = '<b>Decision saved.</b>\n\nWhat is the reason, and when should you review this project again?';
      sendForceReply_('Add the reason and a review date.', 'Monthly review reason');
    }

    else if (action === 'plan_confirm_today') {
      const tasks = getTasksForDate_(now_());
      recordRoutineCheckin_('ROUTINE-DAILY-PLAN', 'Completed', 'Telegram', 'Daily plan confirmed', tasks.length);
      upsertDailyPlanningReview_(now_(), true);

      response =
        '<b>Planning confirmed.</b>\n\nYour plan has been recorded. Keep your priorities visible and adjust only when necessary.';
    }

    else if (action.startsWith('plan_confirm_date|')) {
      const date = action.split('|')[1];
      const planDate = Utilities.parseDate(`${date} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
      if (!isValidDateKey_(date) || dateKey_(planDate) !== date) throw new Error('Planning date is invalid.');
      if (date !== dateKey_(now_())) {
        response = '<b>Plan saved.</b>\n\nThe planning check-in opens after this date begins, during the midnight checkpoint.';
        responseKeyboard = [[{ text: 'Back to home', callback_data: 'home_menu' }]];
      } else {
        const tasks = getTasksForDate_(planDate);
        recordRoutineCheckin_('ROUTINE-DAILY-PLAN', 'Completed', 'Telegram', 'Daily plan confirmed', tasks.length, planDate);
        upsertDailyPlanningReview_(planDate, true);
        response = `<b>Plan confirmed for ${escapeHtml_(date)}.</b>\n\n${tasks.length} task(s) are scheduled.`;
      }
    }

    else if (action === 'plan_remind_later') {
      const scheduled = scheduleRoutineFollowup_('ROUTINE-DAILY-PLAN', 20);
      response = scheduled
        ? '<b>Planning reminder postponed.</b>\n\nThe planning routine remains incomplete. I will remind you again.'
        : '<b>Planning remains incomplete.</b>\n\nThe reminder limit has been reached or a follow-up is already scheduled.';
      result = 'Postponed';
    }

    else if (action === 'plan_help') {
      startCurrentDayPlanning_();
      response = '<b>Let’s plan today.</b>\n\nI’ll ask for one DEEP, WORK, and LIFE outcome at a time.';
    }

    else if (action === 'plan_view_today') {
      syncGoogleTasks();
      const tasks = getTasksForDate_(now_());
      response = tasks.length
        ? '<b>Today’s tasks</b>\n\n' + tasks.slice(0, 15).map(row =>
            `• <b>${escapeHtml_(truncateText_(row[2], 130))}</b> — ${escapeHtml_(row[5] || 'Medium')}`
          ).join('\n')
        : '<b>No dated tasks today.</b>\n\nUse Add something to capture the next action.';
      responseKeyboard = [[getAddTaskButton_()], [{ text: 'Back to home', callback_data: 'home_menu' }]];
    }

    else if (action.startsWith('plan_view_date|')) {
      const date = action.split('|')[1];
      if (!isValidDateKey_(date)) throw new Error('Requested plan date is invalid.');
      const planDate = Utilities.parseDate(`${date} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
      const tasks = getTasksForDate_(planDate);
      const text = tasks.length
        ? tasks.map(row => `• <b>${escapeHtml_(row[2])}</b> — ${escapeHtml_(row[5])}`).join('\n')
        : 'No tasks are scheduled for that date.';
      response = `<b>Tasks for ${escapeHtml_(date)}</b>\n\n${text}`;
    }

    else if (action === 'task_overdue') {
      syncGoogleTasks();
      if (typeof getOverdueTasks_ !== 'function') {
        response = '<b>Google Tasks synchronization is not ready yet.</b>';
        result = 'Unavailable';
      } else {
        const overdue = getOverdueTasks_();
        response = overdue.length
          ? '<b>Overdue tasks:</b>\n\n' + overdue.map((task, index) =>
              `${index + 1}. <b>${escapeHtml_(task[2])}</b>\nDue: ${escapeHtml_(task[7] || 'No due date')}`
            ).join('\n\n')
          : '<b>No overdue tasks.</b>\n\nYou are up to date.';
      }
    }

    else if (action === 'trello_confirm') {
      recordRoutineCheckin_('ROUTINE-TRELLO', 'Completed', 'Telegram');
      upsertDailyPlanningReview_(now_(), getConfirmedRoutine_('ROUTINE-DAILY-PLAN', now_()));
      response = '<b>Trello update recorded.</b>\n\nYour project-maintenance check-in is complete.';
    }

    else if (action === 'obsidian_confirm') {
      recordRoutineCheckin_('ROUTINE-OBSIDIAN', 'Completed', 'Telegram');
      upsertDailyPlanningReview_(now_(), getConfirmedRoutine_('ROUTINE-DAILY-PLAN', now_()));
      response = '<b>Obsidian update recorded.</b>\n\nYour documentation check-in is complete.';
    }

    else if (action.includes('remind_later') || action.includes('not_yet')) {
      const routineId = action.startsWith('trello_') ? 'ROUTINE-TRELLO'
        : action.startsWith('obsidian_') ? 'ROUTINE-OBSIDIAN'
        : 'ROUTINE-DAILY-PLAN';
      const scheduled = scheduleRoutineFollowup_(routineId, 30);
      response = scheduled
        ? '<b>Reminder postponed.</b>\n\nThis routine remains incomplete and will be followed up later.'
        : '<b>This routine remains incomplete.</b>\n\nThe reminder limit has been reached or a follow-up is already scheduled.';
      result = 'Postponed';
    }

    else if (action.startsWith('task_complete|')) {
      completeGoogleTask_(action.split('|')[1]);
      response = '<b>Task marked complete in Google Tasks.</b>';
    }

    else if (action.startsWith('task_keep|')) {
      response = '<b>Task kept pending.</b>\n\nNo status was changed.';
    }

    else if (action.startsWith('task_details|')) {
      const task = getTaskRecordByGoogleId_(action.split('|')[1]);
      response = task
        ? `<b>${escapeHtml_(task[2])}</b>\n\n<b>Status:</b> ${escapeHtml_(task[4])}\n<b>Priority:</b> ${escapeHtml_(task[5])}\n<b>Due:</b> ${escapeHtml_(task[7] || 'Not set')}\n\n${escapeHtml_(task[3] || 'No description.')}`
        : '<b>Task not found.</b>';
    }

    else if (action.startsWith('task_postpone|')) {
      const parts = action.split('|');
      postponeGoogleTask_(parts[1], parts[2]);
      response = `<b>Task postponed to ${escapeHtml_(parts[2])}.</b>`;
    }

    else if (action.startsWith('task_reschedule|')) {
      const task = getTaskRecordByGoogleId_(action.split('|')[1]);
      if (!task || task[4] !== 'Pending') throw new Error('Pending task not found.');
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'task_reschedule', googleTaskId: task[1]
      });
      response = '<b>Move this task.</b>\n\nChoose a new due date or a specific time.';
      sendForceReply_('When should this happen? YYYY-MM-DD or YYYY-MM-DD HH:mm', 'Reschedule task');
    }

    else if (action.startsWith('task_reduce|')) {
      const task = getTaskRecordByGoogleId_(action.split('|')[1]);
      if (!task || task[4] !== 'Pending') throw new Error('Pending task not found.');
      setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
        type: 'task_reduce', googleTaskId: task[1]
      });
      response = `<b>Reduce the scope of:</b>\n\n${escapeHtml_(task[2])}`;
      sendForceReply_('What smaller visible deliverable can you finish?', 'Reduce task scope');
    }

    else if (action.startsWith('task_block|')) {
      const task = getTaskRecordByGoogleId_(action.split('|')[1]);
      if (!task || task[4] !== 'Pending') throw new Error('Pending task not found.');
      response = `<b>What is blocking this?</b>\n\n${escapeHtml_(task[2])}`;
      responseKeyboard = [[
        { text: 'Unclear next step', callback_data: `task_block_reason|${task[1]}|unclear` },
        { text: 'Missing information', callback_data: `task_block_reason|${task[1]}|information` }
      ], [
        { text: 'Low energy', callback_data: `task_block_reason|${task[1]}|energy` },
        { text: 'External dependency', callback_data: `task_block_reason|${task[1]}|external` }
      ]];
    }

    else if (action.startsWith('task_block_reason|')) {
      const parts = action.split('|');
      const task = getTaskRecordByGoogleId_(parts[1]);
      const reasons = { unclear: 'Unclear next step', information: 'Missing information', energy: 'Low energy', external: 'External dependency' };
      if (!task || task[4] !== 'Pending' || !reasons[parts[2]]) throw new Error('Pending task or blocker reason not found.');
      logTaskHistory_(task[0], task[4], task[4], task[7], task[7], `Blocked: ${reasons[parts[2]]}`, 'Telegram');
      response = `<b>Blocker recorded:</b> ${escapeHtml_(reasons[parts[2]])}\n\nThe task remains pending in Google Tasks.`;
      responseKeyboard = [[
        { text: 'Reduce scope', callback_data: `task_reduce|${task[1]}` },
        { text: 'Reschedule', callback_data: `task_reschedule|${task[1]}` }
      ]];
    }

    else if (action.startsWith('task_cancel_prompt|')) {
      const taskId = action.split('|')[1];
      response =
        '<b>Cancel this task?</b>\n\nIt will be removed from Google Tasks, while its database history is retained.';
      responseKeyboard = [[
          { text: 'Confirm cancellation', callback_data: `task_cancel_confirm|${taskId}` },
          { text: 'Keep pending', callback_data: `task_keep|${taskId}` }
        ]];
    }

    else if (action.startsWith('task_cancel_confirm|')) {
      cancelGoogleTask_(action.split('|')[1]);
      response = '<b>Task cancelled.</b>\n\nIts record and history remain in the database.';
    }

    else if (action.startsWith('task_create_confirm|')) {
      const draftKey = `task-draft:${action.split('|')[1]}`;
      const draftJson = CacheService.getScriptCache().get(draftKey);
      if (!draftJson) throw new Error('Task draft expired; start /addtask again.');
      const draft = JSON.parse(draftJson);
      const task = createGoogleTask_(draft.title, draft.priority, draft.dueDate, draft.notes);
      CacheService.getScriptCache().remove(draftKey);
      response = `<b>Task created in Google Tasks.</b>\n\n${escapeHtml_(task.title)}${draft.dueDate ? `\nDue: ${escapeHtml_(draft.dueDate)}` : ''}`;
    }

    else if (action.startsWith('task_create_discard|')) {
      CacheService.getScriptCache().remove(`task-draft:${action.split('|')[1]}`);
      response = '<b>Task draft discarded.</b>\n\nNo task was created.';
    }

    else if (action.startsWith('calendar_create_confirm|')) {
      const draftKey = `calendar-draft:${action.split('|')[1]}`;
      const draftJson = CacheService.getScriptCache().get(draftKey);
      if (!draftJson) throw new Error('Calendar draft expired; start /calendar again.');
      const draft = JSON.parse(draftJson);
      const event = createCalendarEventForTask_(
        draft.title,
        draft.startDateTime,
        draft.endDateTime,
        draft.description
      );
      if (draft.outcomeArea && draft.outcomeDate) {
        updateDailyOutcomeStatus_(
          draft.outcomeDate,
          draft.outcomeArea,
          'Planned',
          'Calendar block explicitly confirmed.',
          '',
          event.getId(),
          new Date(draft.startDateTime),
          new Date(draft.endDateTime)
        );
      }
      CacheService.getScriptCache().remove(draftKey);
      response = `<b>Calendar event created.</b>\n\n${escapeHtml_(draft.title)}\n${escapeHtml_(draft.startLabel)}–${escapeHtml_(draft.endLabel)}`;
    }

    else if (action.startsWith('calendar_create_discard|')) {
      CacheService.getScriptCache().remove(`calendar-draft:${action.split('|')[1]}`);
      response = '<b>Calendar event discarded.</b>\n\nNothing was added to Calendar.';
    }

    else if (action === 'weekly_confirm') {
      recordRoutineCheckin_('ROUTINE-WEEKLY', 'Completed', 'Telegram');
      response = '<b>Weekly review confirmed.</b>';
    }

    else if (action === 'daily_review_confirm') {
      recordRoutineCheckin_('ROUTINE-DAILY-REVIEW', 'Completed', 'Telegram');
      markDailyReviewComplete_(now_());
      response = '<b>Daily review recorded.</b>';
    }

    else if (action === 'shutdown_done') {
      recordRoutineCheckin_('ROUTINE-DAILY-REVIEW', 'Completed', 'Telegram', 'User confirmed there are no open loops to capture.');
      markDailyReviewComplete_(now_());
      response = '<b>Shutdown confirmed.</b>\n\nOpen loops are acknowledged. Tomorrow’s planning conversation starts at 23:20.';
      responseKeyboard = [[{ text: 'Plan tomorrow now', callback_data: 'plan_next_day_now' }]];
    }

    else if (action === 'plan_next_day_now') {
      startNextDayPlanning_();
      response = '<b>Planning conversation started.</b>\n\nI’ll ask one focused question at a time.';
    }

    else if (action === 'calendar_confirm') {
      recordRoutineCheckin_('ROUTINE-CALENDAR', 'Completed', 'Telegram', 'Calendar adherence confirmed by user.');
      upsertDailyPlanningReview_(now_(), getConfirmedRoutine_('ROUTINE-DAILY-PLAN', now_()));
      response = '<b>Calendar check-in recorded.</b>';
    }

    else if (action === 'weekly_unfinished') {
      const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1)
        .filter(row => row[4] === 'Pending' && row[1]).slice(0, 12);
      response = rows.length
        ? '<b>Open next actions</b>\n\n' + rows.map(row =>
            `• <b>${escapeHtml_(truncateText_(row[2], 120))}</b>${row[7] ? ` — ${escapeHtml_(row[7])}` : ''}`
          ).join('\n')
        : '<b>No pending tasks are recorded.</b>';
      responseKeyboard = [[getAddTaskButton_()], [{ text: 'Back to home', callback_data: 'home_menu' }]];
    }

    else if (action === 'weekly_report') {
      response = '<b>The detailed metrics are sent by email.</b>\n\nStart the guided review to capture blockers, open loops, and next week’s experiment.';
      responseKeyboard = [[{ text: 'Start weekly reflection', callback_data: 'weekly_start' }]];
    }

    else if (action === 'weekly_plan') {
      startNextDayPlanning_();
      response = '<b>Planning conversation started.</b>\n\nI’ll ask one focused question at a time.';
    }

    else {
      response = '<b>This action is not available.</b>';
      result = 'Unavailable';
    }

  } catch (error) {
    result = 'Failed';
    const errorLogId = logSystem_('ERROR', 'Telegram', 'Callback', 'Callback processing failed.', error);
    callbackErrorDetails = `${errorLogId}: ${redactSensitiveText_(error && error.message || error)}`;
    response =
      '<b>Action could not be completed.</b>\n\n' +
      'The failure was logged. Reference: ' +
      `<code>${escapeHtml_(errorLogId)}</code>`;
    if (!callbackAcknowledged) {
      callbackAcknowledged = acknowledgeTelegramCallback_(callbackQuery.id, 'Action failed.');
    }
  }

  if (actionLogRow) {
    updateTelegramAction_(actionLogRow, result, result === 'Failed' ? callbackErrorDetails : '');
  }

  if (response) {
    const callbackMessage = callbackQuery.message;
    if (callbackMessage && callbackMessage.chat && callbackMessage.message_id) {
      editTelegramMessage_(
        callbackMessage.chat.id,
        callbackMessage.message_id,
        response,
        responseKeyboard,
        'Button action'
      );
    } else {
      sendTelegramMessage_(response, responseKeyboard, 'Button action');
    }
  }
}

function acknowledgeTelegramCallback_(callbackQueryId, text) {
  try {
    telegramRequest_('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text
    });
    return true;
  } catch (error) {
    logSystem_(
      'WARNING',
      'Telegram',
      'Callback acknowledgement',
      'Could not acknowledge the button click promptly.',
      error
    );
    return false;
  }
}

function editTelegramMessage_(chatId, messageId, text, keyboard, category) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  payload.reply_markup = { inline_keyboard: keyboard && keyboard.length ? keyboard : [] };
  try {
    telegramRequest_('editMessageText', payload);
  } catch (error) {
    if (!String(error.message || '').includes('message is not modified')) throw error;
  }
  logTelegramMessage_({
    chatId: chatId,
    messageId: messageId,
    direction: 'outgoing',
    type: 'edit',
    category: category || 'Button action',
    content: redactSensitiveText_(text),
    deliveryStatus: 'Sent'
  });
  return true;
}

function sendTodayBriefing_(skipSync) {
  if (!skipSync) syncGoogleTasks();
  sendHomeMenu_('Morning briefing');
}

function sendTomorrowPlan_() {
  if (typeof syncGoogleTasks !== 'function' ||
      typeof getTasksForDate_ !== 'function') {
    sendTelegramMessage_(
      '<b>Tomorrow’s Plan</b>\n\nGoogle Tasks synchronization is not installed yet.',
      null,
      'Tomorrow planning'
    );
    return;
  }

  syncGoogleTasks();
  const tomorrow = Utilities.parseDate(`${addDaysDateKey_(1)} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');

  const tasks = getTasksForDate_(tomorrow);
  const taskText = tasks.length
    ? tasks.slice(0, 20).map((task, index) =>
        `${index + 1}. <b>${escapeHtml_(truncateText_(task[2], 140))}</b> — ${escapeHtml_(task[5] || 'Medium')} priority`
      ).join('\n')
    : '<b>Tomorrow is not planned yet.</b>';
  const events = getCalendarEventsForDate_(tomorrow);
  const eventText = events.length
    ? events.map(event => `${escapeHtml_(event.start)}–${escapeHtml_(event.end)} ${escapeHtml_(event.title)}`).join('\n')
    : 'No calendar appointments.';

  const message =
    '<b>Tomorrow’s Plan</b>\n\n' +
    '<b>Planned tasks</b>\n' + taskText + '\n\n' +
    '<b>Appointments</b>\n' + eventText + '\n\n' +
    'Please confirm whether this plan is realistic.';

  const keyboard = [
    [{ text: 'Help me plan', callback_data: 'plan_help' }],
    [{ text: 'View tasks', callback_data: `plan_view_date|${dateKey_(tomorrow)}` }],
    [{ text: 'Back to home', callback_data: 'home_menu' }]
  ];

  sendTelegramMessage_(message, keyboard, 'Tomorrow planning');
}

function getTelegramWebhookInfo() {
  const info = telegramRequest_('getWebhookInfo', {});
  const allowedUpdates = info.allowed_updates || [];
  const configuredRelayUrl = getConfig_(APP.PROPERTIES.TELEGRAM_WEBHOOK_RELAY_URL);
  return {
    configured: Boolean(info.url),
    matchesConfiguredRelay: Boolean(configuredRelayUrl && info.url === configuredRelayUrl),
    allowed_updates: allowedUpdates,
    receivesMessages: allowedUpdates.includes('message'),
    receivesCallbacks: allowedUpdates.includes('callback_query'),
    pending_update_count: info.pending_update_count || 0,
    last_error_date: info.last_error_date || null,
    last_error_message: redactSensitiveText_(info.last_error_message || '')
  };
}

function setTelegramWebhook() {
  return withScriptLock_(() => {
    const relayUrl = requireConfig_(APP.PROPERTIES.TELEGRAM_WEBHOOK_RELAY_URL);
    const webhookSecret = requireConfig_(APP.PROPERTIES.TELEGRAM_WEBHOOK_SECRET);
    if (!/^https:\/\/[^?#]+$/.test(relayUrl)) {
      throw new Error('TELEGRAM_WEBHOOK_RELAY_URL must be an HTTPS URL without query parameters or fragments.');
    }
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
      throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1–256 characters using only letters, numbers, underscores, or hyphens.');
    }

    configureTelegramCommands();
    telegramRequest_('setWebhook', {
      url: relayUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query']
    });

    let pollingTriggersRemoved = 0;
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getHandlerFunction() === 'runTelegramPollingCycle') {
        ScriptApp.deleteTrigger(trigger);
        pollingTriggersRemoved += 1;
      }
    });
    PropertiesService.getScriptProperties().setProperty(APP.PROPERTIES.TELEGRAM_DELIVERY_MODE, 'webhook');
    logSystem_(
      'INFO',
      'Telegram webhook',
      'Enabled',
      `Webhook relay enabled. Removed ${pollingTriggersRemoved} polling trigger(s).`
    );
    return { webhookEnabled: true, pollingTriggersRemoved: pollingTriggersRemoved };
  });
}

function enableTelegramPolling() {
  return withScriptLock_(() => {
    configureTelegramCommands();
    telegramRequest_('deleteWebhook', { drop_pending_updates: true });
    const webhook = telegramRequest_('getWebhookInfo', {});
    if (webhook.url) {
      throw new Error('Telegram still has a webhook configured. Polling cannot start until it is removed.');
    }

    PropertiesService.getScriptProperties().deleteProperty('TELEGRAM_UPDATE_OFFSET');
    PropertiesService.getScriptProperties().setProperty(APP.PROPERTIES.TELEGRAM_DELIVERY_MODE, 'polling');
    let pollingTriggerCreated = false;
    const pollingTriggers = ScriptApp.getProjectTriggers().filter(trigger =>
      trigger.getHandlerFunction() === 'runTelegramPollingCycle'
    );
    if (!pollingTriggers.length) {
      ScriptApp.newTrigger('runTelegramPollingCycle').timeBased().everyMinutes(1).create();
      pollingTriggerCreated = true;
    } else {
      pollingTriggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
    }

    logSystem_(
      'INFO',
      'Telegram polling',
      'Enabled',
      `Polling enabled. Pending Telegram updates were cleared. Trigger ${pollingTriggerCreated ? 'created' : 'verified'}.`
    );
    return {
      pollingEnabled: true,
      webhookDisabled: true,
      pendingUpdatesCleared: true,
      pollingTriggerCreated: pollingTriggerCreated
    };
  });
}

function runTelegramPollingCycle() {
  return withScriptLock_(() => {
    try {
      return runTelegramPollingCycle_();
    } catch (error) {
      logSystem_('ERROR', 'Telegram polling', 'Cycle failed', 'Telegram polling cycle failed.', error);
      throw error;
    }
  });
}

function runTelegramPollingCycle_() {
  const webhook = telegramRequest_('getWebhookInfo', {});
  if (webhook.url) {
    throw new Error('Telegram webhook is still configured. Run enableTelegramPolling() before polling.');
  }

  const properties = PropertiesService.getScriptProperties();
  const offsetValue = Number(properties.getProperty('TELEGRAM_UPDATE_OFFSET') || 0);
  if (!Number.isSafeInteger(offsetValue) || offsetValue < 0) {
    throw new Error('Telegram polling offset is invalid. Run enableTelegramPolling() to reset it.');
  }

  const updates = telegramRequest_('getUpdates', {
    offset: offsetValue,
    limit: 10,
    timeout: 0,
    allowed_updates: ['message', 'callback_query']
  });
  if (!Array.isArray(updates)) {
    throw new Error('Telegram getUpdates returned an invalid update list.');
  }

  updates.forEach(update => {
    try {
      if (update.callback_query) {
        processTelegramCallback_(update.callback_query);
      } else if (update.message) {
        handleTelegramMessage_(update.message);
      } else if (!update.message) {
        logSystem_('INFO', 'Telegram polling', 'Ignored update', 'Update type is not handled.');
      }
    } catch (error) {
      logSystem_('ERROR', 'Telegram polling', 'Update processing failed', 'Could not process a Telegram update.', error);
      if (update.message && update.message.from &&
          isAuthorizedTelegramUser_(update.message.from.id)) {
        try {
          sendTelegramMessage_(
            '<b>That request could not be completed.</b>\n\nCheck the command format or try again. The error has been logged.',
            null,
            'Request failure'
          );
        } catch (deliveryError) {
          logSystem_('ERROR', 'Telegram polling', 'Failure notice', 'Could not send request failure feedback.', deliveryError);
        }
      }
    }

    if (!Number.isSafeInteger(Number(update.update_id))) {
      throw new Error('Telegram update did not contain a valid update_id.');
    }
    properties.setProperty('TELEGRAM_UPDATE_OFFSET', String(Number(update.update_id) + 1));
  });

  if (updates.length) {
    logSystem_('INFO', 'Telegram polling', 'Cycle completed', `Processed ${updates.length} Telegram update(s).`);
  }
  return updates.length;
}

function runTelegramPollingDiagnostics() {
  const diagnostics = getTelegramWebhookInfo();
  const triggers = ScriptApp.getProjectTriggers();
  const result = {
    webhookDisabled: !diagnostics.configured,
    pollingTriggerInstalled: triggers.some(trigger =>
      trigger.getHandlerFunction() === 'runTelegramPollingCycle'
    ),
    pendingUpdateCount: diagnostics.pending_update_count
  };
  console.log(JSON.stringify(result));
  return result;
}

function sendTelegramMessage_(text, keyboard, category, metadata, replyMarkup) {
  const chatId = requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID);
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  } else if (keyboard && keyboard.length) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }

  try {
    const sent = telegramRequest_('sendMessage', payload);
    logTelegramMessage_({
      chatId: chatId,
      messageId: sent.message_id,
      direction: 'outgoing',
      type: 'message',
      category: category || 'Assistant',
      content: redactSensitiveText_(text),
      taskId: metadata && metadata.taskId,
      routineId: metadata && metadata.routineId,
      deliveryStatus: 'Sent'
    });
    return sent;
  } catch (error) {
    logTelegramMessage_({
      chatId: chatId,
      direction: 'outgoing',
      type: 'message',
      category: category || 'Assistant',
      content: redactSensitiveText_(text),
      deliveryStatus: 'Failed',
      errorDetails: redactSensitiveText_(error.message)
    });
    logSystem_('ERROR', 'Telegram', 'Send message', 'Telegram message delivery failed.', error);
    throw error;
  }
}

function sendTaskList_() {
  syncGoogleTasks();
  const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1)
    .filter(row => row[4] === 'Pending' && row[1])
    .slice(0, 8);
  if (!rows.length) {
    sendTelegramMessage_('<b>Pending tasks</b>\n\nNo pending tasks are recorded.', [
      [{ text: 'Add task', callback_data: 'task_add_help' }]
    ], 'Task list');
    return;
  }
  const keyboard = [];
  const taskText = rows.map((row, index) => {
    const title = escapeHtml_(row[2]);
    const due = row[7] ? ` — due ${escapeHtml_(row[7])}` : '';
    keyboard.push([
      { text: `${index + 1} Complete`, callback_data: `task_complete|${row[1]}` },
      { text: `${index + 1} Details`, callback_data: `task_details|${row[1]}` },
      { text: `${index + 1} Keep pending`, callback_data: `task_keep|${row[1]}` }
    ]);
    keyboard.push([
      { text: `${index + 1} Postpone +1d`, callback_data: `task_postpone|${row[1]}|${addDaysDateKey_(1)}` },
      { text: `${index + 1} Reschedule`, callback_data: `task_reschedule|${row[1]}` },
      { text: `${index + 1} Cancel`, callback_data: `task_cancel_prompt|${row[1]}` }
    ]);
    return `${index + 1}. <b>${title}</b>${due} — ${escapeHtml_(row[5] || 'Medium')} priority`;
  }).join('\n');
  sendTelegramMessage_(`<b>Pending tasks</b>\n\n${taskText}`, keyboard, 'Task list');
}

function sendDailyPlanningPrompt_() {
  syncGoogleTasks();
  const day = now_();
  const tasks = getTasksForDate_(day);
  const events = getCalendarEventsForDate_(day);
  const taskText = tasks.length
    ? tasks.slice(0, 20).map(row => `• <b>${escapeHtml_(truncateText_(row[2], 140))}</b> — ${escapeHtml_(row[5] || 'Medium')} priority`).join('\n')
    : 'No tasks are scheduled for today.';
  const eventText = events.length
    ? events.map(event => `• ${escapeHtml_(event.start)} ${escapeHtml_(event.title)}`).join('\n')
    : 'No appointments on the calendar.';
  const planned = tasks.length > 0 || getDailyOutcomes_(day).some(Boolean);
  sendTelegramMessage_(
    `<b>Plan the day</b>\n\n<b>Your three outcomes</b>\n${renderDailyOutcomes_(day)}\n\n<b>Tasks</b>\n${taskText}\n\n<b>Appointments</b>\n${eventText}\n\n<b>Planning status:</b> ${planned ? 'Plan available; please confirm it is realistic.' : 'Not planned yet.'}`,
    [
      [{ text: 'Today is planned', callback_data: 'plan_confirm_today' }],
      [
        { text: 'Not yet / remind later', callback_data: 'plan_remind_later' },
        { text: 'Help me plan', callback_data: 'plan_help' }
      ],
      [{ text: 'View tasks', callback_data: 'plan_view_today' }]
    ],
    'Daily planning',
    { routineId: 'ROUTINE-DAILY-PLAN' }
  );
}

function sendTrelloCheckin_() {
  sendTelegramMessage_(
    '<b>Trello project check-in</b>\n\nReview project status, milestones, blockers, priorities, deadlines, and progress in Trello. Confirm only after the manual update.',
    [[
      { text: 'Trello updated', callback_data: 'trello_confirm' },
      { text: 'Not yet', callback_data: 'trello_not_yet' },
      { text: 'Remind me later', callback_data: 'trello_remind_later' }
    ]],
    'Trello accountability',
    { routineId: 'ROUTINE-TRELLO' }
  );
}

function sendObsidianCheckin_() {
  sendTelegramMessage_(
    '<b>Obsidian knowledge check-in</b>\n\nReview daily notes, decisions, lessons, knowledge, documentation, links, and project archives. Confirm only after the manual update.',
    [[
      { text: 'Obsidian updated', callback_data: 'obsidian_confirm' },
      { text: 'Not yet', callback_data: 'obsidian_not_yet' },
      { text: 'Remind me later', callback_data: 'obsidian_remind_later' }
    ]],
    'Obsidian accountability',
    { routineId: 'ROUTINE-OBSIDIAN' }
  );
}

function handleAddTaskCommand_(text) {
  const content = text.replace(/^\/addtask(?:@\w+)?\s*/i, '').trim();
  if (content) {
    beginTaskCapture_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), content);
  } else {
    sendTaskMiniAppPrompt_();
  }
}

function handleAddCalendarCommand_(text) {
  const fields = text.replace(/^\/calendar(?:@\w+)?\s*/i, '').split('|').map(value => value.trim());
  if (fields.length !== 3 || !fields.every(Boolean)) {
    sendTelegramMessage_(
      '<b>Schedule a task in Calendar</b>\n\nUse:\n<code>/calendar TASK-ID | YYYY-MM-DD HH:mm | YYYY-MM-DD HH:mm</code>\n\nThe event is created only after you confirm the preview.',
      null,
      'Calendar event guide'
    );
    return;
  }
  const task = findTaskByIdentifier_(fields[0]);
  if (!task || task[4] !== 'Pending') {
    sendTelegramMessage_(
      '<b>Pending task not found.</b>\n\nUse the identifier shown in /tasks and choose a task that is still pending.',
      null,
      'Calendar event validation'
    );
    return;
  }
  const start = parseCalendarDateTime_(fields[1]);
  const end = parseCalendarDateTime_(fields[2]);
  if (!start || !end || end <= start) {
    sendTelegramMessage_(
      '<b>Invalid event time.</b>\n\nEnter real Cairo local times in YYYY-MM-DD HH:mm format, with the end after the start.',
      null,
      'Calendar event validation'
    );
    return;
  }
  const draftId = Utilities.getUuid();
  const draft = {
    title: task[2],
    description: task[3] || '',
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    startLabel: Utilities.formatDate(start, APP.TIMEZONE, 'yyyy-MM-dd HH:mm'),
    endLabel: Utilities.formatDate(end, APP.TIMEZONE, 'yyyy-MM-dd HH:mm')
  };
  CacheService.getScriptCache().put(`calendar-draft:${draftId}`, JSON.stringify(draft), 3600);
  sendTelegramMessage_(
    `<b>Confirm Calendar event</b>\n\n<b>Task:</b> ${escapeHtml_(draft.title)}\n<b>Start:</b> ${escapeHtml_(draft.startLabel)}\n<b>End:</b> ${escapeHtml_(draft.endLabel)}\n\nNo event will be created until you confirm.`,
    [[
      { text: 'Create Calendar event', callback_data: `calendar_create_confirm|${draftId}` },
      { text: 'Discard', callback_data: `calendar_create_discard|${draftId}` }
    ]],
    'Calendar event confirmation',
    { taskId: task[0] }
  );
}

function parseCalendarDateTime_(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2}) ([0-2]\d):([0-5]\d)$/);
  if (!match || !isValidDateKey_(match[1]) || Number(match[2]) > 23) return null;
  const parsed = Utilities.parseDate(value, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
  return Utilities.formatDate(parsed, APP.TIMEZONE, 'yyyy-MM-dd HH:mm') === value ? parsed : null;
}

function findTaskByIdentifier_(identifier) {
  const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues();
  return rows.slice(1).find(row =>
    String(row[0]) === String(identifier) || String(row[1]) === String(identifier)
  ) || null;
}

function handlePostponeCommand_(text) {
  const fields = text.replace(/^\/postpone(?:@\w+)?\s*/i, '').split('|').map(value => value.trim());
  if (fields.length !== 2 || !fields[0] || !isValidDateKey_(fields[1])) {
    sendTelegramMessage_(
      '<b>Reschedule a task</b>\n\nUse:\n<code>/postpone TASK-ID | YYYY-MM-DD</code>\n\nUse the task identifier shown in /tasks.',
      null,
      'Reschedule guide'
    );
    return;
  }
  const task = findTaskByIdentifier_(fields[0]);
  if (!task) {
    sendTelegramMessage_('<b>Task not found.</b>\n\nUse /tasks to refresh the task list and copy its identifier.', null, 'Task reschedule validation');
    return;
  }
  postponeGoogleTask_(task[1], fields[1]);
  sendTelegramMessage_(`<b>Task rescheduled.</b>\n\n${escapeHtml_(task[2])}\nNew due date: ${escapeHtml_(fields[1])}`, null, 'Task rescheduled', { taskId: task[0] });
}

function sendCompletedTasks_() {
  syncGoogleTasks();
  const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1)
    .filter(row => row[4] === 'Completed').slice(-10).reverse();
  const text = rows.length
    ? rows.map(row => `• ${escapeHtml_(row[2])} — ${escapeHtml_(row[8] || 'Completed')}`).join('\n')
    : 'No completed tasks are recorded yet.';
  sendTelegramMessage_(`<b>Recently completed tasks</b>\n\n${text}`, null, 'Completed tasks');
}

function sendProgressReport_() {
  syncGoogleTasks();
  const rows = getSheet_(APP.SHEETS.TASKS).getDataRange().getValues().slice(1);
  const pending = rows.filter(row => row[4] === 'Pending');
  const completed = rows.filter(row => row[4] === 'Completed');
  const overdue = getOverdueTasks_().length;
  const today = getSheet_(APP.SHEETS.DAILY_REVIEWS).getDataRange().getValues().slice(1)
    .find(row => String(row[0]) === dateKey_(now_()));
  sendTelegramMessage_(
    `<b>Progress</b>\n\n<b>Pending:</b> ${pending.length}\n<b>Completed:</b> ${completed.length}\n<b>Overdue:</b> ${overdue}\n<b>Today’s accountability score:</b> ${today ? today[10] : 'Not calculated'}`,
    null,
    'Progress'
  );
}

function sendAccountabilityStatus_() {
  const score = calculateAccountabilityScore_(now_());
  const tasks = getTasksForDate_(now_());
  const confirmed = score === '' ? 'Not enough confirmed activity' : `${score}/100 — ${getAccountabilityRating_(score)}`;
  sendTelegramMessage_(
    `<b>Today’s accountability</b>\n\n<b>Score:</b> ${confirmed}\n<b>Scheduled tasks:</b> ${tasks.length}\n<b>Planning:</b> ${getConfirmedRoutine_('ROUTINE-DAILY-PLAN', now_()) ? 'Confirmed' : 'Not confirmed'}\n\nScores use confirmed activities only. Cancelled and rescheduled tasks are not treated as failures; categories without confirmed data are excluded and the remaining weights are normalized.`,
    null,
    'Accountability'
  );
}

function sendWeeklyReport_() {
  const report = buildWeeklyReport_();
  sendTelegramMessage_(
    '<b>Weekly review</b>\n\n' +
    'We’ll look at your DEEP, WORK, and LIFE outcomes; repeated blockers; one open loop to delete, delegate, or schedule; one experiment; and one project decision.\n\n' +
    'The detailed metrics are in the weekly email. Start the guided reflection when ready.',
    [
      [{ text: 'Start weekly reflection', callback_data: 'weekly_start' }],
      [{ text: 'Unfinished tasks', callback_data: 'weekly_unfinished' }, { text: 'Plan next week', callback_data: 'weekly_plan' }],
      [{ text: 'Confirm weekly review', callback_data: 'weekly_confirm' }]
    ],
    'Weekly review'
  );
  sendReportEmail_('Weekly productivity report', report.text, report.metrics.start);
}

function sendMonthlyReport_() {
  const report = buildMonthlyReport_();
  sendTelegramMessage_(
    `${report.text}\n\n<b>Project decision:</b> continue, change approach, pause, or kill. Record a reason and a review date.`,
    [
      [{ text: 'Review a project', callback_data: 'monthly_project_review' }],
      [{ text: 'Back to home', callback_data: 'home_menu' }]
    ],
    'Monthly review'
  );
  sendReportEmail_('Monthly productivity report', report.text, report.metrics.start);
}

function upsertDailyPlanningReview_(date, planned) {
  const sheet = getSheet_(APP.SHEETS.DAILY_REVIEWS);
  const key = dateKey_(date);
  const tasks = getTasksForDate_(date);
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[0]) === key);
  const score = calculateAccountabilityScore_(date);
  if (rowIndex > 0) {
    sheet.getRange(rowIndex + 1, 2).setValue(tasks.length);
    sheet.getRange(rowIndex + 1, 4).setValue(tasks.filter(row => row[4] === 'Pending').length);
    sheet.getRange(rowIndex + 1, 7).setValue(Boolean(planned));
    sheet.getRange(rowIndex + 1, 8).setValue(getConfirmedRoutine_('ROUTINE-TRELLO', date));
    sheet.getRange(rowIndex + 1, 9).setValue(getConfirmedRoutine_('ROUTINE-OBSIDIAN', date));
    sheet.getRange(rowIndex + 1, 10).setValue(getConfirmedRoutine_('ROUTINE-DAILY-REVIEW', date));
    sheet.getRange(rowIndex + 1, 11).setValue(score);
    sheet.getRange(rowIndex + 1, 12).setValue(`Score ${score === '' ? 'not available' : score}; based on confirmed activities.`);
    return;
  }
  const row = [
    key, tasks.length, 0, tasks.length, 0, 0, Boolean(planned),
    getConfirmedRoutine_('ROUTINE-TRELLO', date),
    getConfirmedRoutine_('ROUTINE-OBSIDIAN', date),
    getConfirmedRoutine_('ROUTINE-DAILY-REVIEW', date),
    score,
    `Score ${score === '' ? 'not available' : score}; based on confirmed activities.`
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function markDailyReviewComplete_(date) {
  const sheet = getSheet_(APP.SHEETS.DAILY_REVIEWS);
  const key = dateKey_(date);
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[0]) === key);
  if (rowIndex > 0) {
    sheet.getRange(rowIndex + 1, 10).setValue(true);
    const score = calculateAccountabilityScore_(date);
    sheet.getRange(rowIndex + 1, 11).setValue(score);
    sheet.getRange(rowIndex + 1, 12).setValue(`Score ${score === '' ? 'not available' : score}; based on confirmed activities.`);
    return;
  }
  const tasks = getTasksForDate_(date);
  const score = calculateAccountabilityScore_(date);
  const row = [key, tasks.length, 0, tasks.length, 0, getOverdueTasks_().length, false, false, false, true, score, `Score ${score === '' ? 'not available' : score}; daily review explicitly confirmed.`];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function scheduleRoutineFollowup_(routineId, delayMinutes) {
  const due = new Date(Date.now() + delayMinutes * 60000);
  const sheet = getSheet_(APP.SHEETS.REMINDER_HISTORY);
  const values = sheet.getDataRange().getValues();
  const existing = values.some((row, index) =>
    index > 0 && String(row[2]) === String(routineId) && row[6] === 'Scheduled' &&
    row[3] && new Date(row[3]).getTime() > Date.now()
  );
  if (existing) return false;
  const routines = getSheet_(APP.SHEETS.ROUTINES).getDataRange().getValues();
  const routine = routines.slice(1).find(row => String(row[0]) === String(routineId));
  const maximum = Number(routine && routine[6] || getSetting_('MAX_REMINDERS', 3));
  const today = dateKey_(now_());
  const sentCount = values.slice(1).filter(row =>
    String(row[2]) === String(routineId) && row[3] && normalizeDateKey_(row[3]) === today &&
    (row[6] === 'Sent' || row[6] === 'Scheduled')
  ).length;
  if (sentCount >= maximum) return false;
  const reminderNumber = values.slice(1).filter(row =>
    String(row[2]) === String(routineId) && row[3] && normalizeDateKey_(row[3]) === dateKey_(due)
  ).length + 1;
  const row = [
    newId_('REM'), 'Routine follow-up', routineId, due, '', reminderNumber,
    'Scheduled', 'Reminder later', '', due
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return true;
}