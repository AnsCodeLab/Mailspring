import React from 'react';
import { DOMUtils, SectionStore } from 'mailspring-exports';
import type { SectionDeclaration } from 'mailspring-exports';
import { InjectedComponentSet } from 'mailspring-component-kit';
import { SectionDock } from './section-dock';

interface State {
  current: string;
  sections: SectionDeclaration[];
}

/**
 * The single component in the main window's RootSidebar. It renders the active
 * section's panel (components registered for role `SectionSidebar:<id>`) above the
 * section dock, and owns the column's width bounds.
 */
export class SectionSidebar extends React.Component<Record<string, unknown>, State> {
  static displayName = 'SectionSidebar';
  static containerRequired = false;
  static containerStyles = {
    minWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-min-width', 165),
    maxWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-max-width', 250),
  };

  state = this._getState();
  _unlisten?: () => void;

  componentDidMount() {
    this._unlisten = SectionStore.listen(() => this.setState(this._getState()));
  }

  componentWillUnmount() {
    this._unlisten?.();
  }

  _getState(): State {
    return { current: SectionStore.current(), sections: SectionStore.sections() };
  }

  render() {
    const { current, sections } = this.state;
    const section = sections.find((s) => s.id === current);
    return (
      <div className={`section-sidebar section-sidebar-${current}`}>
        <h2 className="section-sidebar-title">{section?.title}</h2>
        <InjectedComponentSet
          key={current}
          className="section-sidebar-panel"
          direction="column"
          containersRequired={false}
          matching={{ role: `SectionSidebar:${current}` }}
        />
        <SectionDock sections={sections} current={current} />
      </div>
    );
  }
}
