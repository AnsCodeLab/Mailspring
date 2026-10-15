import moment, { Moment } from 'moment';
import MailspringStore from 'mailspring-store';

/**
 * The date the calendar is focused on. The section sidebar's mini-month and the calendar
 * view render in different columns, so they share this instead of component state.
 */
class CalendarViewStoreImpl extends MailspringStore {
  private _focusedMoment: Moment = moment();

  focusedMoment() {
    return this._focusedMoment;
  }

  setFocusedMoment(m: Moment) {
    if (m.isSame(this._focusedMoment)) {
      return;
    }
    this._focusedMoment = m;
    this.trigger();
  }
}

export const CalendarViewStore = new CalendarViewStoreImpl();
