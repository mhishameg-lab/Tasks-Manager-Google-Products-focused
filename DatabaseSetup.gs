function setupDatabase() {
  const ss = getDb_();
  ss.setSpreadsheetTimeZone(APP.TIMEZONE);

  const schemas = {
    Dashboard: [],

    Tasks: [
      'Internal Record ID', 'Google Task ID', 'Task Title', 'Description',
      'Status', 'Priority', 'Creation Date', 'Due Date', 'Completion Date',
      'Last Updated', 'Postponement Count', 'Last Reminder',
      'Escalation Status', 'Notes'
    ],

    Telegram_Messages: [
      'Message Log ID', 'Telegram Chat ID', 'Telegram Message ID',
      'Direction', 'Message Type', 'Message Category', 'Message Content',
      'Related Task ID', 'Related Routine ID', 'Timestamp',
      'Delivery Status', 'Error Details', 'Callback Information'
    ],

    Telegram_Actions: [
      'Action ID', 'Telegram User ID', 'Callback Query ID',
      'Button Identifier', 'Action Name', 'Related Task or Routine',
      'Action Result', 'Timestamp', 'Error Details'
    ],

    Reminder_History: [
      'Reminder ID', 'Reminder Category', 'Related Task or Routine',
      'Scheduled Time', 'Actual Sent Time', 'Reminder Number',
      'Delivery Status', 'User Response', 'Confirmation Time',
      'Follow-up Scheduled Time'
    ],

    Task_History: [
      'Task ID', 'Previous Status', 'New Status', 'Previous Due Date',
      'New Due Date', 'Action Type', 'Source of Action', 'Timestamp', 'History ID'
    ],

    Accountability_Routines: [
      'Routine ID', 'Routine Name', 'Frequency', 'Scheduled Time',
      'Active Status', 'Reminder Configuration', 'Maximum Reminders',
      'Description'
    ],

    Accountability_Checkins: [
      'Check-in ID', 'Routine ID', 'Date', 'Status',
      'Confirmation Method', 'Confirmation Timestamp',
      'Reminder Count', 'Postponement Count', 'Notes', 'Tasks Scheduled'
    ],

    Daily_Reviews: [
      'Date', 'Total Tasks', 'Completed Tasks', 'Incomplete Tasks',
      'Postponed Tasks', 'Overdue Tasks', 'Daily Planning Completed',
      'Trello Routine Completed', 'Obsidian Routine Completed',
      'Daily Review Completed', 'Accountability Score', 'Observations'
    ],

    Weekly_Reviews: [
      'Week Starting Date', 'Tasks Created', 'Tasks Completed',
      'Tasks Overdue', 'Postponements', 'Planning Consistency',
      'Trello Maintenance Rate', 'Obsidian Maintenance Rate',
      'Average Accountability Score', 'Repeated Problems',
      'Recommendations'
    ],

    Monthly_Reviews: [
      'Month', 'Tasks Created', 'Tasks Completed', 'Task Completion Rate',
      'Overdue Tasks', 'Postponements', 'Planning Consistency',
      'Trello Maintenance Rate', 'Obsidian Maintenance Rate',
      'Average Accountability Score', 'Recurring Problems',
      'Improvements', 'Recommendations'
    ],

    Email_Escalations: [
      'Escalation ID', 'Related Task ID', 'Recipient', 'Email Subject',
      'Escalation Reason', 'Escalation Level', 'Sent Timestamp',
      'Delivery Result', 'Previous Escalations'
    ],

    System_Logs: [
      'Log ID', 'Timestamp', 'Severity', 'Component', 'Event Type',
      'Description', 'Execution ID', 'Related Record ID',
      'Error Message', 'Stack Trace'
    ],

    Settings: [
      'Setting Key', 'Setting Value', 'Description', 'Category',
      'Last Updated'
    ],

    Sync_Logs: [
      'Sync Log ID', 'Source', 'Operation', 'Timestamp', 'Result',
      'Error Details', 'Retry Count', 'Related Record ID'
    ]
  };

  Object.keys(schemas).forEach(sheetName => {
    if (sheetName === APP.SHEETS.DASHBOARD) return;
    setupDataSheet_(getOrCreateSheet_(ss, sheetName), schemas[sheetName]);
  });

  seedSettings_();
  seedRoutines_();
  buildDashboard_(getOrCreateSheet_(ss, APP.SHEETS.DASHBOARD));

  logSystem_('INFO', 'Setup', 'Database setup', 'Database tabs created or verified.');
  SpreadsheetApp.flush();
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setupDataSheet_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    headers.forEach((header, index) => {
      if (existingHeaders[index] !== header) {
        if (existingHeaders[index]) {
          throw new Error(`Unexpected header in ${sheet.getName()} column ${index + 1}; refusing to overwrite existing data.`);
        }
        sheet.getRange(1, index + 1).setValue(header);
      }
    });
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setWrap(true)
    .setHorizontalAlignment('center');

  const filter = sheet.getFilter();
  if (!filter || filter.getRange().getNumColumns() < headers.length) {
    if (filter) filter.remove();
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length)
      .createFilter();
  }

  sheet.autoResizeColumns(1, headers.length);

  for (let column = 1; column <= headers.length; column++) {
    sheet.setColumnWidth(column, Math.max(120, sheet.getColumnWidth(column)));
    const header = headers[column - 1];
    if (/timestamp|updated|created|sent|scheduled time|confirmation time/i.test(header)) {
      sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1)
        .setNumberFormat('yyyy-mm-dd hh:mm:ss');
    } else if (/^date$|due date|completion date|week starting date|^month$/i.test(header)) {
      sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1)
        .setNumberFormat('yyyy-mm-dd');
    }
  }

  applyValidation_(sheet, headers);
  applyConditionalFormatting_(sheet, headers);
}

function applyValidation_(sheet, headers) {
  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const indexOf = header => headers.indexOf(header) + 1;
  if (indexOf('Status')) {
    sheet.getRange(2, indexOf('Status'), rowCount, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(['Pending', 'Completed', 'Cancelled', 'Deleted', 'Missed', 'Not yet', 'Postponed'])
          .setAllowInvalid(false)
          .build()
      );
  }
  if (indexOf('Priority')) {
    sheet.getRange(2, indexOf('Priority'), rowCount, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(['High', 'Medium', 'Low'])
          .setAllowInvalid(false)
          .build()
      );
  }

  if (indexOf('Severity')) {
    sheet.getRange(2, indexOf('Severity'), rowCount, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(['INFO', 'WARNING', 'ERROR'])
          .setAllowInvalid(false)
          .build()
      );
  }
}

function applyConditionalFormatting_(sheet, headers) {
  const rules = [];
  const statusColumn = headers.indexOf('Status') + 1;
  if (statusColumn) {
    const range = sheet.getRange(2, statusColumn, Math.max(sheet.getMaxRows() - 1, 1), 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Completed').setBackground('#D9EAD3').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Pending').setBackground('#FFF2CC').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Cancelled').setBackground('#E6E6E6').setRanges([range]).build());
  }
  const dueColumn = headers.indexOf('Due Date') + 1;
  if (statusColumn && dueColumn) {
    const fullRows = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), headers.length);
    const statusLetter = sheet.getRange(1, statusColumn).getA1Notation().replace(/\d/g, '');
    const dueLetter = sheet.getRange(1, dueColumn).getA1Notation().replace(/\d/g, '');
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($${statusLetter}2="Pending",$${dueLetter}2<TEXT(TODAY(),"yyyy-mm-dd"),$${dueLetter}2<>"")`)
      .setBackground('#F4CCCC').setRanges([fullRows]).build());
  }
  const deliveryColumn = headers.indexOf('Delivery Result') + 1;
  if (deliveryColumn) {
    const range = sheet.getRange(2, deliveryColumn, Math.max(sheet.getMaxRows() - 1, 1), 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Failed').setBackground('#F4CCCC').setRanges([range]).build());
  }
  const deliveryStatusColumn = headers.indexOf('Delivery Status') + 1;
  if (deliveryStatusColumn) {
    const range = sheet.getRange(2, deliveryStatusColumn, Math.max(sheet.getMaxRows() - 1, 1), 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Failed').setBackground('#F4CCCC').setRanges([range]).build());
  }
  const escalationColumn = headers.indexOf('Escalation Status') + 1;
  if (escalationColumn) {
    const range = sheet.getRange(2, escalationColumn, Math.max(sheet.getMaxRows() - 1, 1), 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Escalated').setBackground('#F4CCCC').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Failed').setBackground('#F4CCCC').setRanges([range]).build());
  }
  const severityColumn = headers.indexOf('Severity') + 1;
  if (severityColumn) {
    const range = sheet.getRange(2, severityColumn, Math.max(sheet.getMaxRows() - 1, 1), 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('ERROR').setBackground('#F4CCCC').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('WARNING').setBackground('#FCE5CD').setRanges([range]).build());
  }
  sheet.setConditionalFormatRules(rules);
}

function seedSettings_() {
  const sheet = getSheet_(APP.SHEETS.SETTINGS);
  const rows = [
    ['TIMEZONE', 'Africa/Cairo', 'Timezone for all schedules', 'Core', now_()],
    ['MORNING_REMINDER_TIME', '08:00', 'Morning briefing time', 'Reminder', now_()],
    ['PLANNING_REMINDER_1', '00:00', 'Initial planning reminder', 'Planning', now_()],
    ['PLANNING_REMINDER_2', '00:20', 'Second planning reminder', 'Planning', now_()],
    ['PLANNING_REMINDER_3', '00:45', 'Final planning reminder', 'Planning', now_()],
    ['PLANNING_WINDOW_START', '00:00', 'Start of midnight planning reminder window', 'Planning', now_()],
    ['PLANNING_WINDOW_END', '01:00', 'End of midnight planning reminder window', 'Planning', now_()],
    ['MAX_REMINDERS', '3', 'Maximum reminders for a routine', 'Reminder', now_()],
    ['EMAIL_ESCALATION_HOURS', '24', 'Hours overdue before email escalation', 'Escalation', now_()],
    ['TASK_COMPLETION_WEIGHT', '0.30', 'Accountability score weight', 'Scoring', now_()],
    ['CALENDAR_ADHERENCE_WEIGHT', '0.15', 'Accountability score weight', 'Scoring', now_()],
    ['TRELLO_WEIGHT', '0.20', 'Accountability score weight', 'Scoring', now_()],
    ['OBSIDIAN_WEIGHT', '0.20', 'Accountability score weight', 'Scoring', now_()],
    ['PLANNING_REVIEW_WEIGHT', '0.15', 'Accountability score weight', 'Scoring', now_()]
  ];

  const existing = new Set(sheet.getDataRange().getValues().slice(1).map(row => String(row[0])));
  const missing = rows.filter(row => !existing.has(String(row[0])));
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, missing[0].length).setValues(missing);
  }
}

function seedRoutines_() {
  const sheet = getSheet_(APP.SHEETS.ROUTINES);
  const routines = [
    [
      'ROUTINE-DAILY-PLAN', 'Daily planning', 'Daily', '00:00',
      'Active', '00:00, 00:20, 00:45', 3,
      'Plan and confirm the day that has just begun.'
    ],
    [
      'ROUTINE-DAILY-REVIEW', 'Daily review', 'Daily', '22:30',
      'Active', '22:30, 22:50, 23:15', 3,
      'Review completed, incomplete, and postponed tasks.'
    ],
    [
      'ROUTINE-TRELLO', 'Trello updates', 'Daily', '19:00',
      'Active', '19:00, 19:30, 20:00', 3,
      'Manual Trello project-status and milestone update.'
    ],
    [
      'ROUTINE-OBSIDIAN', 'Obsidian updates', 'Daily', '20:00',
      'Active', '20:00, 20:30, 21:00', 3,
      'Manual notes, decisions, lessons, and documentation update.'
    ],
    [
      'ROUTINE-CALENDAR', 'Calendar adherence', 'Daily', '22:30',
      'Active', '22:30', 1,
      'Confirm whether scheduled appointments were followed or explicitly rescheduled.'
    ],
    [
      'ROUTINE-WEEKLY', 'Weekly review', 'Weekly', 'Friday 18:00',
      'Active', '18:00, 18:30, 19:00', 3,
      'Review weekly outcomes and prepare next week.'
    ],
    [
      'ROUTINE-MONTHLY', 'Monthly review', 'Monthly', '1st 18:00',
      'Active', '18:00, 18:30, 19:00', 3,
      'Review trends, repeated problems, and improvements.'
    ]
  ];

  const existing = new Set(sheet.getDataRange().getValues().slice(1).map(row => String(row[0])));
  const missing = routines.filter(row => !existing.has(String(row[0])));
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, missing[0].length).setValues(missing);
  }
}

function buildDashboard_(sheet) {
  sheet.getRange(1, 1, 44, 13).getMergedRanges()
    .forEach(range => range.breakApart());
  sheet.clearContents();
  sheet.clearFormats();
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));
  sheet.setFrozenRows(2);

  sheet.getRange('A1:H1').merge()
    .setValue('PERSONAL PRODUCTIVITY DATABASE — DASHBOARD')
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF')
    .setFontSize(16)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange('A3:B3').setValues([['Today', '=TODAY()']]);

  sheet.getRange('A5:B18').setValues([
    ['Today’s tasks', '=COUNTIFS(Tasks!H:H,TODAY(),Tasks!E:E,"Pending")+COUNTIFS(Tasks!H:H,TEXT(TODAY(),"yyyy-mm-dd"),Tasks!E:E,"Pending")'],
    ['Tomorrow’s tasks', '=COUNTIFS(Tasks!H:H,TODAY()+1,Tasks!E:E,"Pending")+COUNTIFS(Tasks!H:H,TEXT(TODAY()+1,"yyyy-mm-dd"),Tasks!E:E,"Pending")'],
    ['Overdue tasks', '=SUMPRODUCT((Tasks!E2:E10000="Pending")*(Tasks!H2:H10000<>"")*(IFERROR(DATEVALUE(Tasks!H2:H10000),Tasks!H2:H10000)<TODAY()))'],
    ['Completed tasks', '=COUNTIF(Tasks!E:E,"Completed")'],
    ['Pending tasks', '=COUNTIF(Tasks!E:E,"Pending")'],
    ['Completion rate', '=IFERROR(B8/(B8+B9),0)'],
    ['Planning consistency (7d)', '=IFERROR((COUNTIFS(Daily_Reviews!A:A,">="&TODAY()-6,Daily_Reviews!A:A,"<="&TODAY(),Daily_Reviews!G:G,TRUE)+COUNTIFS(Daily_Reviews!A:A,">="&TEXT(TODAY()-6,"yyyy-mm-dd"),Daily_Reviews!A:A,"<="&TEXT(TODAY(),"yyyy-mm-dd"),Daily_Reviews!G:G,TRUE))/(COUNTIFS(Daily_Reviews!A:A,">="&TODAY()-6,Daily_Reviews!A:A,"<="&TODAY())+COUNTIFS(Daily_Reviews!A:A,">="&TEXT(TODAY()-6,"yyyy-mm-dd"),Daily_Reviews!A:A,"<="&TEXT(TODAY(),"yyyy-mm-dd"))),0)'],
    ['Latest daily score', '=IFERROR(LOOKUP(2,1/(Daily_Reviews!K:K<>""),Daily_Reviews!K:K),"")'],
    ['Latest weekly score', '=IFERROR(LOOKUP(2,1/(Weekly_Reviews!I:I<>""),Weekly_Reviews!I:I),"")'],
    ['Trello check-in today', '=COUNTIFS(Accountability_Checkins!B:B,"ROUTINE-TRELLO",Accountability_Checkins!C:C,TODAY(),Accountability_Checkins!D:D,"Completed")+COUNTIFS(Accountability_Checkins!B:B,"ROUTINE-TRELLO",Accountability_Checkins!C:C,TEXT(TODAY(),"yyyy-mm-dd"),Accountability_Checkins!D:D,"Completed")'],
    ['Obsidian check-in today', '=COUNTIFS(Accountability_Checkins!B:B,"ROUTINE-OBSIDIAN",Accountability_Checkins!C:C,TODAY(),Accountability_Checkins!D:D,"Completed")+COUNTIFS(Accountability_Checkins!B:B,"ROUTINE-OBSIDIAN",Accountability_Checkins!C:C,TEXT(TODAY(),"yyyy-mm-dd"),Accountability_Checkins!D:D,"Completed")'],
    ['Recent Telegram messages', '=COUNTA(Telegram_Messages!A2:A)'],
    ['Email escalations', '=COUNTA(Email_Escalations!A2:A)'],
    ['System errors', '=COUNTIF(System_Logs!C:C,"ERROR")']
  ]);

  sheet.getRange('D3:E3').merge()
    .setValue('System readiness')
    .setFontWeight('bold')
    .setBackground('#D9EAF7');

  sheet.getRange('D5:E10').setValues([
    ['Database', 'Ready'],
    ['Timezone', 'Africa/Cairo'],
    ['Google Tasks', '=IF(COUNTA(Tasks!A2:A)>0,"Connected","No tasks synced")'],
    ['Telegram', '=IF(COUNTA(Telegram_Messages!A2:A)>0,"Active","No messages yet")'],
    ['Email escalation', '=IF(COUNTA(Email_Escalations!A2:A)>0,"Used","Ready for test")'],
    ['Latest system event', '=IFERROR(LOOKUP(2,1/(System_Logs!F:F<>""),System_Logs!F:F),"No logs yet")']
  ]);

  sheet.getRange('A3:A18').setFontWeight('bold').setBackground('#D9EAF7');
  sheet.getRange('D5:D10').setFontWeight('bold');
  sheet.getRange('B10').setNumberFormat('0%');
  sheet.getRange('G3:H3').setValues([['Recent Telegram time', 'Message']])
    .setFontWeight('bold').setBackground('#D9EAF7');
  sheet.getRange('G4').setFormula('=IFERROR(QUERY({Telegram_Messages!J2:J,Telegram_Messages!G2:G},"select Col1,Col2 where Col1 is not null order by Col1 desc limit 10",0),"")');
  sheet.getRange('J3:M3').setValues([['Recent reminder time', 'Category', 'Related record', 'Delivery']])
    .setFontWeight('bold').setBackground('#D9EAF7');
  sheet.getRange('J4').setFormula('=IFERROR(QUERY({Reminder_History!E2:E,Reminder_History!B2:B,Reminder_History!C2:C,Reminder_History!G2:G},"select Col1,Col2,Col3,Col4 where Col1 is not null order by Col1 desc limit 10",0),"")');
  sheet.getRange('G17:J17').setValues([['Escalation time', 'Task record', 'Subject', 'Delivery']])
    .setFontWeight('bold').setBackground('#D9EAF7');
  sheet.getRange('G18').setFormula('=IFERROR(QUERY({Email_Escalations!G2:G,Email_Escalations!B2:B,Email_Escalations!D2:D,Email_Escalations!H2:H},"select Col1,Col2,Col3,Col4 where Col1 is not null order by Col1 desc limit 10",0),"")');
  sheet.getRange('K32:L32').setValues([['Week starting', 'Average score']])
    .setFontWeight('bold').setBackground('#D9EAF7');
  for (let row = 33; row <= 44; row++) {
    sheet.getRange(row, 11, 1, 2).setFormulas([[
      `=IFERROR(INDEX(Weekly_Reviews!A$2:A,COUNTA(Weekly_Reviews!A$2:A)-MIN(12,COUNTA(Weekly_Reviews!A$2:A))+ROWS($K$33:K${row})),"")`,
      `=IFERROR(INDEX(Weekly_Reviews!I$2:I,COUNTA(Weekly_Reviews!A$2:A)-MIN(12,COUNTA(Weekly_Reviews!A$2:A))+ROWS($L$33:L${row})),"")`
    ]]);
  }
  sheet.getRange('K33:K44').setNumberFormat('yyyy-mm-dd');
  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange('K32:L44'))
    .setPosition(20, 1, 0, 0)
    .setOption('title', 'Weekly accountability trend')
    .setOption('legend', { position: 'none' })
    .build();
  sheet.insertChart(chart);
  const taskStatusChart = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange('A8:B9'))
    .setPosition(36, 1, 0, 0)
    .setOption('title', 'Completed vs pending tasks')
    .setOption('pieHole', 0.45)
    .build();
  sheet.insertChart(taskStatusChart);
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(protection => protection.getDescription() === 'Dashboard formulas')
    .forEach(protection => protection.remove());
  sheet.getRange('A5:B18').protect().setDescription('Dashboard formulas').setWarningOnly(true);

  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 220);
  sheet.setColumnWidth(7, 180);
  sheet.setColumnWidth(8, 320);
  sheet.setColumnWidth(10, 160);
  sheet.setColumnWidth(11, 140);
  sheet.setColumnWidth(12, 140);
  sheet.setColumnWidth(13, 140);
}