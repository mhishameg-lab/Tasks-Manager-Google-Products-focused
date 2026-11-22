const TELEGRAM_BOT_COMMANDS = [
  { command: 'start', description: 'Open your daily home' },
  { command: 'today', description: 'See today’s outcomes and calendar' },
  { command: 'tomorrow', description: 'Preview tomorrow’s tasks and appointments' },
  { command: 'addtask', description: 'Capture a next action' },
  { command: 'focus', description: 'Start a focused work block' },
  { command: 'tasks', description: 'Browse all pending tasks' },
  { command: 'overdue', description: 'Review overdue tasks' },
  { command: 'progress', description: 'Review recent progress' },
  { command: 'review', description: 'Plan or confirm today' },
  { command: 'capture', description: 'Route an action, project, or idea' },
  { command: 'weekly', description: 'Review the week and decide next steps' },
  { command: 'monthly', description: 'Review monthly trends and projects' },
  { command: 'habits', description: 'Check in on Trello and Obsidian' },
  { command: 'accountability', description: 'Review today’s score and check-ins' },
  { command: 'settings', description: 'See how the system is organized' },
  { command: 'help', description: 'Open the action control panel' }
];

function configureTelegramCommands() {
  telegramRequest_('setMyCommands', { commands: TELEGRAM_BOT_COMMANDS });
  logSystem_('INFO', 'Telegram', 'Commands configured', 'Telegram command menu was updated.');
  return true;
}

function getTaskMiniAppUrl_() {
  const webAppUrl = getConfig_(APP.PROPERTIES.WEB_APP_URL);
  if (!webAppUrl || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(webAppUrl)) {
    return '';
  }
  return `${webAppUrl.split('?')[0]}?view=taskform`;
}

function getAddTaskButton_() {
  const url = getTaskMiniAppUrl_();
  return url
    ? { text: 'Add something', web_app: { url: url } }
    : { text: 'Add something', callback_data: 'task_add_help' };
}

function buildControlPanelKeyboard_() {
  return [
    [{ text: 'Plan my day', callback_data: 'plan_my_day' }, getAddTaskButton_()],
    [{ text: 'Focus now', callback_data: 'focus_now' }, { text: 'Review progress', callback_data: 'review_progress' }],
    [{ text: 'Capture an idea', callback_data: 'capture_idea' }, { text: 'Weekly review', callback_data: 'weekly_start' }],
    [{ text: 'Settings', callback_data: 'settings_show' }]
  ];
}

function sendHomeMenu_(category) {
  const events = getCalendarEventsForDate_(now_());
  const appointments = events.length
    ? events.slice(0, 5).map(event => `• ${escapeHtml_(event.start)} ${escapeHtml_(truncateText_(event.title, 90))}`).join('\n')
    : 'No calendar appointments today.';
  sendTelegramMessage_(
    `<b>Good morning.</b>\n\n<b>Your three outcomes</b>\n${renderDailyOutcomes_(now_())}\n\n<b>Today’s calendar</b>\n${appointments}\n\nWhat do you want to move forward now?`,
    [
      [{ text: 'Start DEEP', callback_data: 'outcome_start|DEEP' }, { text: 'Start WORK', callback_data: 'outcome_start|WORK' }],
      [{ text: 'Start LIFE', callback_data: 'outcome_start|LIFE' }],
      [getAddTaskButton_(), { text: 'Show full plan', callback_data: 'home_show_plan' }]
    ],
    category || 'Daily home'
  );
}

function sendHelpControlPanel_() {
  sendTelegramMessage_(
    '<b>What do you need?</b>\n\n' +
    '• Plan my day\n• Add a task\n• Focus now\n• Review progress\n• Capture an idea\n• Weekly review\n• Settings\n\n' +
    '<i>Shortcuts:</i> /today · /tasks · /weekly · /monthly · /help',
    buildControlPanelKeyboard_(),
    'Control panel'
  );
}

function sendSettingsPanel_() {
  sendTelegramMessage_(
    '<b>How this system works</b>\n\n' +
    '• Google Tasks — actionable next steps and their status\n' +
    '• Google Calendar — when work and appointments happen\n' +
    '• Trello — projects and stages (manual check-in)\n' +
    '• Obsidian — ideas, decisions, learning, and reflection\n' +
    '• Telegram — capture, planning, focus, and clear decisions\n\n' +
    'Your time zone is Africa/Cairo. Use /today to return to your plan.',
    [[{ text: 'Back to today', callback_data: 'home_show_plan' }]],
    'Settings'
  );
}

function sendCaptureChoices_() {
  sendTelegramMessage_(
    '<b>What are you capturing?</b>\n\n' +
    'A next action goes to Google Tasks. A project belongs in Trello. An idea belongs in your Obsidian Inbox or Someday.',
    [[
      { text: 'Next action', callback_data: 'capture_next_action' },
      { text: 'Project', callback_data: 'capture_project' },
      { text: 'Idea', callback_data: 'capture_idea' }
    ]],
    'Capture routing'
  );
}

function sendForceReply_(text, category) {
  return sendTelegramMessage_(text, null, category || 'Guided prompt', null, {
    force_reply: true,
    selective: true,
    input_field_placeholder: 'Type one short answer'
  });
}

function setTelegramConversation_(chatId, state) {
  CacheService.getScriptCache().put(`telegram-conversation:${chatId}`, JSON.stringify(state), 3600);
}

function clearTelegramConversation_(chatId) {
  CacheService.getScriptCache().remove(`telegram-conversation:${chatId}`);
}

function beginTaskCapture_(chatId, title) {
  if (title) {
    const draftId = Utilities.getUuid();
    CacheService.getScriptCache().put(`task-draft:${draftId}`, JSON.stringify({
      title: title,
      area: 'Other',
      priority: 'Medium',
      dueDate: '',
      doneTest: ''
    }), 3600);
    setTelegramConversation_(chatId, { type: 'task_due', draftId: draftId });
    sendTelegramMessage_(
      `<b>${escapeHtml_(title)}</b>\n\nWhen does it need to be done?`,
      [
        [
          { text: 'Today', callback_data: `task_due_today|${draftId}` },
          { text: 'Tomorrow', callback_data: `task_due_tomorrow|${draftId}` }
        ],
        [
          { text: 'This week', callback_data: `task_due_week|${draftId}` },
          { text: 'Choose date', callback_data: `task_due_choose|${draftId}` }
        ],
        [{ text: 'No deadline', callback_data: `task_due_none|${draftId}` }]
      ],
      'Task capture'
    );
    return;
  }
  setTelegramConversation_(chatId, { type: 'task_title' });
  sendForceReply_('<b>What is the next action you want to capture?</b>\n\nYou can use a short natural sentence.', 'Task capture');
}

function sendTaskMiniAppPrompt_() {
  const url = getTaskMiniAppUrl_();
  if (url) {
    sendTelegramMessage_(
      '<b>Add a task</b>\n\nOpen the form to choose an area, priority, date, optional Calendar block, and a clear done test.',
      [[{ text: 'Open task form', web_app: { url: url } }]],
      'Task Mini App'
    );
  } else {
    beginTaskCapture_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID));
  }
}

function beginFocusNow_() {
  const outcomes = getDailyOutcomes_(now_()).filter(row => row && !['Completed', 'Dropped'].includes(String(row[5])));
  if (outcomes.length) {
    const row = outcomes.find(item => item[1] === 'DEEP') || outcomes[0];
    beginOutcomeSprint_(row[1]);
    return;
  }
  sendTelegramMessage_(
    '<b>Nothing is set as today’s outcome yet.</b>\n\nAdd a next action and mark it as DEEP, WORK, or LIFE.',
    [[getAddTaskButton_()]],
    'Focus now'
  );
}

function beginOutcomeSprint_(area, outcomeDate) {
  const date = outcomeDate || dateKey_(now_());
  const outcome = getDailyOutcomes_(date).find(row => row && row[1] === area);
  if (!outcome) throw new Error(`No ${area} outcome is set for ${date}.`);
  setTelegramConversation_(requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID), {
    type: 'focus_action',
    area: area,
    date: date
  });
  sendForceReply_(
    `<b>${area} outcome:</b> ${escapeHtml_(outcome[2])}\n\nWhat is the smallest visible result you can finish in the next 25–50 minutes?`,
    'Focus prompt'
  );
}

function processTelegramConversation_(message) {
  if (!message || !message.chat || !message.text || String(message.text).startsWith('/')) return false;
  const cache = CacheService.getScriptCache();
  const key = `telegram-conversation:${message.chat.id}`;
  const stateText = cache.get(key);
  if (!stateText) return false;
  const state = JSON.parse(stateText);
  const answer = String(message.text).trim();
  if (!answer) return true;

  if (state.type === 'task_title') {
    if (answer.length > 500) {
      sendForceReply_('Keep the task title under 500 characters. What is the next action?', 'Task capture');
      return true;
    }
    beginTaskCapture_(message.chat.id, answer);
    return true;
  }
  if (state.type === 'task_due_date') {
    if (!isValidDateKey_(answer)) {
      sendForceReply_('Enter a real date as YYYY-MM-DD, for example 2026-11-23.', 'Task due date');
      return true;
    }
    setTaskDraftDueDate_(state.draftId, answer, message.chat.id);
    return true;
  }
  if (state.type === 'task_done_test') {
    finishGuidedTaskCapture_(message.chat.id, state.draftId, answer);
    return true;
  }
  if (state.type === 'task_reschedule') {
    const task = getTaskRecordByGoogleId_(state.googleTaskId);
    if (!task || task[4] !== 'Pending') throw new Error('Only a pending task can be rescheduled.');
    const blockStart = parseCalendarDateTime_(answer);
    if (blockStart) {
      if (blockStart.getTime() <= Date.now()) {
        sendForceReply_('Choose a future Cairo time as YYYY-MM-DD HH:mm.', 'Reschedule task');
        return true;
      }
      const end = new Date(blockStart.getTime() + 25 * 60000);
      postponeGoogleTask_(task[1], dateKey_(blockStart));
      createCalendarEventForTask_(
        task[2],
        blockStart.toISOString(),
        end.toISOString(),
        'Task focus block scheduled by explicit user rescheduling.'
      );
      appendReviewNote_('Task reschedule', dateKey_(blockStart), 'Scheduled focus block', task[2], '');
    } else if (isValidDateKey_(answer)) {
      postponeGoogleTask_(task[1], answer);
    } else {
      sendForceReply_('Enter a date as YYYY-MM-DD or a Cairo time as YYYY-MM-DD HH:mm.', 'Reschedule task');
      return true;
    }
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Task rescheduled.</b>\n\n${escapeHtml_(task[2])}\n${escapeHtml_(answer)}`,
      [[{ text: 'Show full plan', callback_data: 'home_show_plan' }]],
      'Task rescheduled',
      { taskId: task[0] }
    );
    return true;
  }
  if (state.type === 'task_reduce') {
    const task = reduceGoogleTask_(state.googleTaskId, answer);
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Scope reduced.</b>\n\n${escapeHtml_(task.title)}\n\nThe task remains pending in Google Tasks.`,
      [[{ text: 'Show full plan', callback_data: 'home_show_plan' }]],
      'Task scope reduced'
    );
    return true;
  }
  if (state.type === 'today_plan_deep') {
    setTelegramConversation_(message.chat.id, {
      type: 'today_plan_work', date: state.date, deep: answer
    });
    sendForceReply_('<b>Plan today — WORK</b>\n\nWhat does done look like for your one work outcome, and when will you do it?', 'Daily planning');
    return true;
  }
  if (state.type === 'today_plan_work') {
    setTelegramConversation_(message.chat.id, {
      type: 'today_plan_life', date: state.date, deep: state.deep, work: answer
    });
    sendForceReply_('<b>Plan today — LIFE</b>\n\nWhat does done look like for your one health or admin outcome, and when will you do it?', 'Daily planning');
    return true;
  }
  if (state.type === 'today_plan_life') {
    const date = Utilities.parseDate(`${state.date} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
    const replaced = [];
    [
      ['DEEP', state.deep, 'High'],
      ['WORK', state.work, 'High'],
      ['LIFE', answer, 'Medium']
    ].forEach(item => {
      const current = getDailyOutcomes_(date).find(row => row && row[1] === item[0]);
      const sameOutcome = current && String(current[2]) === item[1];
      let taskId = sameOutcome ? current[4] : '';
      let status = sameOutcome ? current[5] : 'Planned';
      if (current && !sameOutcome && current[4]) replaced.push(item[0]);
      if (!taskId) {
        const task = createGoogleTask_(
          item[1],
          item[2],
          state.date,
          `Area: ${item[0]}\nDone looks like: ${item[1]}`
        );
        taskId = task.id;
        status = 'Planned';
      }
      appendDailyOutcome_(
        date,
        item[0],
        item[1],
        `Complete the stated outcome: ${item[1]}`,
        taskId,
        status,
        '',
        '',
        '',
        'Created through guided daily planning.'
      );
    });
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Today’s outcomes are ready.</b>\n\n${renderDailyOutcomes_(date)}\n\nThree actionable Google Tasks are linked. Calendar events were not created.` +
        (replaced.length ? `\n\nPrevious ${replaced.join(', ')} task(s) remain pending; review them in your full task list.` : ''),
      [[{ text: 'Start DEEP', callback_data: 'outcome_start|DEEP' }, { text: 'Show full plan', callback_data: 'home_show_plan' }]],
      'Daily planning'
    );
    return true;
  }
  if (state.type === 'outcome_define') {
    if (answer.length > 500) {
      sendForceReply_('Keep the outcome under 500 characters. What will done look like?', 'Define daily outcome');
      return true;
    }
    const date = Utilities.parseDate(`${state.date} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
    const priority = state.area === 'LIFE' ? 'Medium' : 'High';
    const task = createGoogleTask_(
      answer,
      priority,
      state.date,
      `Area: ${state.area}\nDone looks like: ${answer}`
    );
    appendDailyOutcome_(
      date,
      state.area,
      answer,
      `Complete the stated outcome: ${answer}`,
      task.id,
      'Planned',
      '',
      '',
      '',
      'Created from the Telegram focus prompt.'
    );
    clearTelegramConversation_(message.chat.id);
    beginOutcomeSprint_(state.area, state.date);
    return true;
  }
  if (state.type === 'focus_action') {
    updateDailyOutcomeStatus_(state.date, state.area, 'In progress', answer);
    setTelegramConversation_(message.chat.id, {
      type: 'focus_duration',
      area: state.area,
      date: state.date,
      action: answer
    });
    sendTelegramMessage_(
      '<b>Choose a focus block.</b>\n\nI’ll check back when the block ends.',
      [[
        { text: '25 minutes', callback_data: `focus_duration|${state.date}|${state.area}|25` },
        { text: '50 minutes', callback_data: `focus_duration|${state.date}|${state.area}|50` }
      ]],
      'Focus duration'
    );
    return true;
  }
  if (state.type === 'work_briefing_target') {
    appendReviewNote_('Work briefing', state.date, 'SDR target', answer, 'WORK');
    setTelegramConversation_(message.chat.id, { type: 'work_briefing_hypothesis', date: state.date });
    sendForceReply_('<b>Work briefing — 2/3</b>\n\nWhat is your hypothesis for reaching that target?', 'Work briefing');
    return true;
  }
  if (state.type === 'work_briefing_hypothesis') {
    appendReviewNote_('Work briefing', state.date, 'SDR hypothesis', answer, 'WORK');
    setTelegramConversation_(message.chat.id, { type: 'work_briefing_learning', date: state.date });
    sendForceReply_('<b>Work briefing — 3/3</b>\n\nWhat is one learning question to test during the shift?', 'Work briefing');
    return true;
  }
  if (state.type === 'work_briefing_learning') {
    appendReviewNote_('Work briefing', state.date, 'Learning question', answer, 'WORK');
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      '<b>Work intention saved.</b>\n\nKeep the target visible, test your hypothesis, and capture one useful learning.',
      [[{ text: 'Start WORK', callback_data: 'outcome_start|WORK' }, { text: 'Show full plan', callback_data: 'home_show_plan' }]],
      'Work briefing'
    );
    return true;
  }
  if (state.type === 'outcome_reduce') {
    updateDailyOutcomeStatus_(state.date, state.area, 'In progress', 'Reduced scope by user.', answer);
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Scope reduced.</b>\n\n${escapeHtml_(answer)}\n\nChoose a focused next step when you’re ready.`,
      [[
        { text: `Start ${state.area}`, callback_data: `outcome_start|${state.date}|${state.area}` },
        { text: 'Show full plan', callback_data: 'home_show_plan' }
      ]],
      'Outcome reduced'
    );
    return true;
  }
  if (state.type === 'outcome_reschedule') {
    const start = parseCalendarDateTime_(answer);
    if (!start || start.getTime() <= Date.now()) {
      sendForceReply_('Enter a future Cairo time as YYYY-MM-DD HH:mm.', 'Reschedule outcome');
      return true;
    }
    const outcome = getDailyOutcomes_(state.date).find(row => row && row[1] === state.area);
    if (!outcome) throw new Error(`No ${state.area} outcome is set for today.`);
    const end = new Date(start.getTime() + 25 * 60000);
    const task = outcome[4] ? getTaskRecordByGoogleId_(outcome[4]) : null;
    if (task && task[4] === 'Pending') postponeGoogleTask_(task[1], dateKey_(start));
    const event = createCalendarEventForTask_(
      `${state.area}: ${outcome[2]}`,
      start.toISOString(),
      end.toISOString(),
      'Focus block rescheduled by the user from Telegram.'
    );
    updateDailyOutcomeStatus_(
      state.date,
      state.area,
      'Rescheduled',
      `Moved to ${Utilities.formatDate(start, APP.TIMEZONE, 'yyyy-MM-dd HH:mm')}.`,
      '',
      event.getId(),
      start,
      end
    );
    clearTelegramConversation_(message.chat.id);
    sendHomeMenu_('Rescheduled outcome');
    return true;
  }
  if (state.type === 'outcome_drop') {
    updateDailyOutcomeStatus_(state.date, state.area, 'Dropped', answer);
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      '<b>Outcome dropped.</b>\n\nI recorded your reason. The related Google Task remains pending; no task was deleted or cancelled.',
      [[{ text: 'Show full plan', callback_data: 'home_show_plan' }]],
      'Outcome dropped'
    );
    return true;
  }
  if (state.type === 'project_capture') {
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Project noted.</b>\n\n${escapeHtml_(answer)}\n\nKeep the project and its stages in Trello. I do not write to Trello; add or update it there, then use the manual check-in if useful.`,
      [[{ text: 'Back to home', callback_data: 'home_menu' }]],
      'Project capture'
    );
    return true;
  }
  if (state.type === 'idea_capture') {
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Idea captured for your next Obsidian Inbox update.</b>\n\n${escapeHtml_(answer)}\n\nI do not write to Obsidian; add this manually to Inbox or Someday.`,
      [[{ text: 'Back to home', callback_data: 'home_menu' }]],
      'Idea capture'
    );
    return true;
  }
  if (state.type === 'weekly_review') {
    const questions = getWeeklyReviewQuestions_();
    const index = Number(state.index);
    if (!questions[index]) {
      clearTelegramConversation_(message.chat.id);
      return true;
    }
    appendReviewNote_('Weekly', state.date, questions[index].text, answer, questions[index].area);
    if (index + 1 < questions.length) {
      sendWeeklyReviewQuestion_(message.chat.id, index + 1, state.date);
    } else {
      clearTelegramConversation_(message.chat.id);
      recordRoutineCheckin_('ROUTINE-WEEKLY', 'Completed', 'Telegram', 'Completed guided weekly reflection.');
      sendTelegramMessage_(
        '<b>Weekly reflection saved.</b>\n\nYour answers are available in Review_Notes. Choose one open loop to delete, delegate, or schedule.',
        [[{ text: 'Open unfinished tasks', callback_data: 'weekly_unfinished' }, { text: 'Back to home', callback_data: 'home_menu' }]],
        'Weekly review'
      );
    }
    return true;
  }
  if (state.type === 'monthly_project_name') {
    setTelegramConversation_(message.chat.id, { type: 'monthly_project_decision', date: state.date, project: answer });
    sendTelegramMessage_(
      `<b>${escapeHtml_(answer)}</b>\n\nChoose one decision.`,
      [[
        { text: 'Continue', callback_data: 'monthly_decision|continue' },
        { text: 'Change approach', callback_data: 'monthly_decision|change' }
      ], [
        { text: 'Pause', callback_data: 'monthly_decision|pause' },
        { text: 'Kill', callback_data: 'monthly_decision|kill' }
      ]],
      'Monthly project review'
    );
    return true;
  }
  if (state.type === 'monthly_project_reason') {
    appendReviewNote_('Monthly project decision', state.date, `Decision: ${state.decision}; reason and review date`, answer, state.project);
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      '<b>Project decision recorded.</b>\n\nInclude the reason and next review date in your Trello project card. No Trello API is used.',
      [[{ text: 'Review another project', callback_data: 'monthly_project_review' }, { text: 'Back to home', callback_data: 'home_menu' }]],
      'Monthly project review'
    );
    return true;
  }
  if (state.type === 'next_day_done') {
    appendReviewNote_('Daily shutdown', state.reviewDate, 'DONE today', answer, '');
    setTelegramConversation_(message.chat.id, {
      type: 'next_day_deep', date: state.date, reviewDate: state.reviewDate
    });
    sendForceReply_('<b>Plan tomorrow — 2/5</b>\n\nWhat is the one DEEP growth outcome?', 'Next-day planning');
    return true;
  }
  if (state.type === 'next_day_deep') {
    setTelegramConversation_(message.chat.id, {
      type: 'next_day_work', date: state.date, reviewDate: state.reviewDate, deep: answer
    });
    sendForceReply_('<b>Plan tomorrow — 3/5</b>\n\nWhat is the one WORK / SDR outcome?', 'Next-day planning');
    return true;
  }
  if (state.type === 'next_day_work') {
    setTelegramConversation_(message.chat.id, {
      type: 'next_day_life', date: state.date, reviewDate: state.reviewDate,
      deep: state.deep, work: answer
    });
    sendForceReply_('<b>Plan tomorrow — 4/5</b>\n\nWhat is the one LIFE health or admin outcome?', 'Next-day planning');
    return true;
  }
  if (state.type === 'next_day_life') {
    setTelegramConversation_(message.chat.id, {
      type: 'next_day_risk', date: state.date, reviewDate: state.reviewDate,
      deep: state.deep, work: state.work, life: answer
    });
    sendForceReply_('<b>Plan tomorrow — 5/5</b>\n\nWhat is the main RISK that could derail the day?', 'Next-day planning');
    return true;
  }
  if (state.type === 'next_day_risk') {
    const tomorrow = Utilities.parseDate(`${state.date} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
    const replaced = [];
    [
      ['DEEP', state.deep, 'High'],
      ['WORK', state.work, 'High'],
      ['LIFE', state.life, 'Medium']
    ].forEach(item => {
      const current = getDailyOutcomes_(tomorrow).find(row => row && row[1] === item[0]);
      let taskId = current && current[2] === item[1] ? current[4] : '';
      if (current && current[2] !== item[1] && current[4]) replaced.push(item[0]);
      if (!taskId) {
        const task = createGoogleTask_(
          item[1],
          item[2],
          state.date,
          `Area: ${item[0]}\nDone test: define the visible result before starting.\nRisk: ${answer}`
        );
        taskId = task.id;
      }
      appendDailyOutcome_(tomorrow, item[0], item[1], 'Define the visible result before starting.', taskId, 'Planned', '', '', '', `Risk: ${answer}`);
    });
    appendReviewNote_('Next-day planning', state.reviewDate, 'RISK that could derail the day', answer, '');
    clearTelegramConversation_(message.chat.id);
    sendTelegramMessage_(
      `<b>Tomorrow has a clear shape.</b>\n\n${renderDailyOutcomes_(tomorrow)}\n\n<b>Risk:</b> ${escapeHtml_(answer)}\n\nThree actionable Google Tasks are ready. The 00:00–01:00 planning confirmation remains the final checkpoint.` +
        (replaced.length ? `\n\nPrevious ${replaced.join(', ')} task(s) remain pending; review them in the full task list.` : ''),
      [
        [getAddTaskButton_()],
        [{ text: 'Back to home', callback_data: 'home_menu' }]
      ],
      'Next-day planning'
    );
    return true;
  }
  return false;
}

function setTaskDraftDueDate_(draftId, dueDate, chatId) {
  const key = `task-draft:${draftId}`;
  const draftText = CacheService.getScriptCache().get(key);
  if (!draftText) throw new Error('Task draft expired. Please start again.');
  const draft = JSON.parse(draftText);
  draft.dueDate = dueDate;
  CacheService.getScriptCache().put(key, JSON.stringify(draft), 3600);
  setTelegramConversation_(chatId, { type: 'task_done_test', draftId: draftId });
  sendForceReply_('What would count as done?', 'Task done test');
}

function finishGuidedTaskCapture_(chatId, draftId, doneTest) {
  const cache = CacheService.getScriptCache();
  const draftKey = `task-draft:${draftId}`;
  const draftText = cache.get(draftKey);
  if (!draftText) throw new Error('Task draft expired. Please start again.');
  const draft = JSON.parse(draftText);
  const notes = [
    `Area: ${draft.area || 'Other'}`,
    doneTest ? `Done looks like: ${doneTest}` : ''
  ].filter(Boolean).join('\n');
  const task = createGoogleTask_(draft.title, draft.priority || 'Medium', draft.dueDate || '', notes);
  cache.remove(draftKey);
  clearTelegramConversation_(chatId);
  sendTelegramMessage_(
    `<b>Task added.</b>\n\n${escapeHtml_(task.title)}${draft.dueDate ? `\nDue: ${escapeHtml_(draft.dueDate)}` : ''}`,
    [[getAddTaskButton_(), { text: 'Show full plan', callback_data: 'home_show_plan' }]],
    'Guided task capture'
  );
}

function getWeeklyReviewQuestions_() {
  return [
    { text: 'On how many days did you complete your DEEP, WORK, and LIFE outcomes? Include the areas that felt clear.', area: 'DEEP/WORK/LIFE' },
    { text: 'What repeatedly blocked you? Choose the pattern, not a judgment about yourself.', area: 'Blockers' },
    { text: 'Which open loop should be deleted, delegated, or scheduled?', area: 'Open loop' },
    { text: 'What is one small experiment for next week?', area: 'Experiment' },
    { text: 'Which project needs a continue, pause, or kill decision?', area: 'Project' }
  ];
}

function sendWeeklyReviewQuestion_(chatId, index, reviewDate) {
  const questions = getWeeklyReviewQuestions_();
  setTelegramConversation_(chatId, { type: 'weekly_review', index: index, date: reviewDate });
  sendForceReply_(`<b>Weekly review ${index + 1}/${questions.length}</b>\n\n${escapeHtml_(questions[index].text)}`, 'Weekly review');
}

function startNextDayPlanning_() {
  const today = dateKey_(now_());
  const tomorrow = Utilities.parseDate(`${addDaysDateKey_(1)} 12:00`, APP.TIMEZONE, 'yyyy-MM-dd HH:mm');
  const chatId = requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID);
  setTelegramConversation_(chatId, {
    type: 'next_day_done', date: dateKey_(tomorrow), reviewDate: today
  });
  sendForceReply_('<b>Plan tomorrow — 1/5</b>\n\nWhat got DONE today?', 'Next-day planning');
}

function startCurrentDayPlanning_() {
  const date = dateKey_(now_());
  const chatId = requireConfig_(APP.PROPERTIES.TELEGRAM_CHAT_ID);
  setTelegramConversation_(chatId, { type: 'today_plan_deep', date: date });
  sendForceReply_(
    '<b>Plan today — DEEP</b>\n\nWhat does done look like for your one growth outcome, and when will you do it?',
    'Daily planning'
  );
}
