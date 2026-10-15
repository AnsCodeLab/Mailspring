import React from 'react';
import { Moment } from 'moment';
import { Rx, DatabaseStore, AccountStore, Calendar, Account } from 'mailspring-exports';
import { ScrollRegion, MiniMonthView } from 'mailspring-component-kit';
import { CalendarSourceList } from './calendar-source-list';
import { CalendarViewStore } from '../calendar-view-store';

const DISABLED_CALENDARS = 'mailspring.disabledCalendars';

interface State {
  accounts: Account[];
  calendars: Calendar[];
  disabledCalendars: string[];
  focusedMoment: Moment;
}

export class CalendarSidebarPanel extends React.Component<Record<string, unknown>, State> {
  static displayName = 'CalendarSidebarPanel';

  state: State = {
    accounts: AccountStore.accounts(),
    calendars: [],
    disabledCalendars: AppEnv.config.get(DISABLED_CALENDARS) || [],
    focusedMoment: CalendarViewStore.focusedMoment(),
  };

  _subscription?: { dispose(): void };
  _unlisten?: () => void;

  componentDidMount() {
    this._subscription = Rx.Observable.combineLatest(
      Rx.Observable.fromQuery(DatabaseStore.findAll<Calendar>(Calendar)),
      Rx.Observable.fromStore(AccountStore),
      Rx.Observable.fromConfig<string[] | undefined>(DISABLED_CALENDARS)
    ).subscribe(([calendars, accountStore, disabled]) =>
      this.setState({
        calendars,
        accounts: accountStore.accounts(),
        disabledCalendars: disabled || [],
      })
    );
    this._unlisten = CalendarViewStore.listen(() =>
      this.setState({ focusedMoment: CalendarViewStore.focusedMoment() })
    );
  }

  componentWillUnmount() {
    this._subscription?.dispose();
    this._unlisten?.();
  }

  render() {
    return (
      <div className="calendar-sidebar-panel">
        <ScrollRegion style={{ flex: 1 }}>
          <CalendarSourceList
            accounts={this.state.accounts}
            calendars={this.state.calendars}
            disabledCalendars={this.state.disabledCalendars}
          />
        </ScrollRegion>
        <MiniMonthView
          value={this.state.focusedMoment}
          onChange={(m) => CalendarViewStore.setFocusedMoment(m)}
        />
      </div>
    );
  }
}
