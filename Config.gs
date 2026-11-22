const APP = {
  TIMEZONE: 'Africa/Cairo',

  SHEETS: {
    DASHBOARD: 'Dashboard',
    TASKS: 'Tasks',
    TELEGRAM_MESSAGES: 'Telegram_Messages',
    TELEGRAM_ACTIONS: 'Telegram_Actions',
    REMINDER_HISTORY: 'Reminder_History',
    TASK_HISTORY: 'Task_History',
    ROUTINES: 'Accountability_Routines',
    CHECKINS: 'Accountability_Checkins',
    DAILY_REVIEWS: 'Daily_Reviews',
    WEEKLY_REVIEWS: 'Weekly_Reviews',
    MONTHLY_REVIEWS: 'Monthly_Reviews',
    EMAIL_ESCALATIONS: 'Email_Escalations',
    SYSTEM_LOGS: 'System_Logs',
    SETTINGS: 'Settings',
    SYNC_LOGS: 'Sync_Logs'
  },

  PROPERTIES: {
    TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
    TELEGRAM_CHAT_ID: 'TELEGRAM_CHAT_ID',
    AUTHORIZED_TELEGRAM_USER_ID: 'AUTHORIZED_TELEGRAM_USER_ID',
    WEBHOOK_SECRET: 'WEBHOOK_SECRET',
    GOOGLE_TASK_LIST_ID: 'GOOGLE_TASK_LIST_ID',
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    WEB_APP_URL: 'WEB_APP_URL'
  }
};

function getConfig_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function formatDateTime_(value) {
  return Utilities.formatDate(new Date(value), APP.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function requireConfig_(key) {
  const value = getConfig_(key);
  if (!value) throw new Error(`Missing required Script Property: ${key}`);
  return value;
}