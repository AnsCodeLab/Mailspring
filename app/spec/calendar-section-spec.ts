import moment from 'moment';
import { CalendarViewStore } from '../internal_packages/main-calendar/lib/calendar-view-store';
import { enterCalendarSection } from '../internal_packages/main-calendar/lib/main';

describe('Calendar section', function () {
  it('opens on today and requests a calendar sync on entry', function () {
    spyOn(AppEnv.mailsyncBridge, 'sendSyncCalendarNow');
    CalendarViewStore.setFocusedMoment(moment().subtract(40, 'days'));
    enterCalendarSection();
    expect(CalendarViewStore.focusedMoment().isSame(moment(), 'day')).toBe(true);
    expect(AppEnv.mailsyncBridge.sendSyncCalendarNow).toHaveBeenCalled();
  });
});
