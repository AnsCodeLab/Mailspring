import moment from 'moment';
import { CalendarViewStore } from '../internal_packages/main-calendar/lib/calendar-view-store';

describe('CalendarViewStore', function () {
  it('notifies listeners when the focused moment changes', function () {
    const listener = jasmine.createSpy('listener');
    const unlisten = CalendarViewStore.listen(listener);
    const target = moment('2026-10-20T09:00:00');
    CalendarViewStore.setFocusedMoment(target);
    expect(CalendarViewStore.focusedMoment().isSame(target)).toBe(true);
    expect(listener).toHaveBeenCalled();
    unlisten();
  });

  it('does not notify when set to the same moment', function () {
    const target = moment('2026-10-21T09:00:00');
    CalendarViewStore.setFocusedMoment(target);
    const listener = jasmine.createSpy('listener');
    const unlisten = CalendarViewStore.listen(listener);
    CalendarViewStore.setFocusedMoment(moment(target));
    expect(listener).not.toHaveBeenCalled();
    unlisten();
  });
});
