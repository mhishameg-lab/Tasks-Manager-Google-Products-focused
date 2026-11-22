function getCalendarEventsForDate_(date) {
  const dateKey = dateKey_(date);
  const cache = CacheService.getScriptCache();
  const cacheKey = `calendar-events:${dateKey}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached).map(event => ({
      ...event,
      startTime: new Date(event.startTime),
      endTime: new Date(event.endTime)
    }));
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  try {
    const events = retryTransient_(() => CalendarApp.getDefaultCalendar()
      .getEvents(start, end), 3)
      .map(event => ({
        id: event.getId(),
        title: event.getTitle(),
        startTime: event.getStartTime(),
        endTime: event.getEndTime(),
        start: Utilities.formatDate(event.getStartTime(), APP.TIMEZONE, 'HH:mm'),
        end: Utilities.formatDate(event.getEndTime(), APP.TIMEZONE, 'HH:mm')
      }));
    const serializedEvents = JSON.stringify(events);
    if (serializedEvents.length < 90000) cache.put(cacheKey, serializedEvents, 300);
    if (!cache.get(`calendar-read:${dateKey}`)) {
      logSync_('Google Calendar', 'Read events', 'Success', `${events.length} event(s) for ${dateKey}.`, 0);
      cache.put(`calendar-read:${dateKey}`, '1', 21600);
    }
    return events;
  } catch (error) {
    logSync_('Google Calendar', 'Read events', 'Failed', error.message, 0);
    logSystem_('ERROR', 'Google Calendar', 'Read events', 'Calendar event retrieval failed.', error);
    throw error;
  }
}

function createCalendarEventForTask_(title, startDateTime, endDateTime, description) {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  if (!title || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    throw new Error('Calendar event requires a title and a valid end time after its start time.');
  }
  try {
    const event = CalendarApp.getDefaultCalendar().createEvent(title, start, end, {
      description: description || 'Created by Productivity Assistant'
    });
    logSync_('Google Calendar', 'Create event', 'Success', '', 0, event.getId());
    return event;
  } catch (error) {
    logSync_('Google Calendar', 'Create event', 'Failed', error.message, 0);
    logSystem_('ERROR', 'Google Calendar', 'Create event', 'Calendar event creation failed.', error);
    throw error;
  }
}