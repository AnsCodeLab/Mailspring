import React from 'react';
import { ipcRenderer } from 'electron';
import MailspringStore from 'mailspring-store';
import * as Actions from '../actions';
import WorkspaceStore from './workspace-store';
import { IMenuItem } from '../../menu-helpers';

type SheetDeclaration = ReturnType<typeof WorkspaceStore.rootSheet>;

export type SectionId = string;

export interface SectionDeclaration {
  id: SectionId;
  title: string;
  icon: React.ComponentType;
  rootSheet: () => SheetDeclaration;
  menu?: IMenuItem;
  hiddenMenuIds?: string[];
  onEnter?: () => void;
  overflow?: boolean;
  openInNewWindowCommand?: string;
}

interface StashedMenu {
  index: number;
  item: IMenuItem;
}

/**
 * Owns which top-level section the main window shows. Mail is always registered and is the
 * section at startup; calendar and contacts register themselves when their packages activate
 * in the main window.
 *
 * Menus are stashed rather than rebuilt from a snapshot because account-commands rewrites the
 * Window submenu at runtime; only the section's own hidden menus are removed and restored.
 */
class SectionStore extends MailspringStore {
  private _sections: SectionDeclaration[] = [];
  private _current: SectionId = 'mail';
  private _mailRootSheet: SheetDeclaration | null = null;
  private _stashedMenus: StashedMenu[] = [];
  private _insertedMenuId: string | null = null;

  constructor() {
    super();
    this._sections = [this._mailSection()];
    this.listenTo(Actions.selectSection, this._onSelectSection);

    if (AppEnv.isMainWindow()) {
      AppEnv.commands.add(document.body, {
        'navigation:section-mail': () => Actions.selectSection('mail'),
        'navigation:section-calendar': () => Actions.selectSection('calendar'),
        'navigation:section-contacts': () => Actions.selectSection('contacts'),
      });
      ipcRenderer.on('select-section', (_event, id: SectionId) => Actions.selectSection(id));
    }
  }

  current() {
    return this._current;
  }

  sections() {
    return this._sections;
  }

  registerSection(decl: SectionDeclaration) {
    this._sections = [...this._sections.filter((s) => s.id !== decl.id), decl];
    this.trigger();
    return {
      dispose: () => {
        if (this._current === decl.id) {
          this._onSelectSection('mail');
        }
        this._sections = this._sections.filter((s) => s !== decl);
        this.trigger();
      },
    };
  }

  _mailSection(): SectionDeclaration {
    return {
      id: 'mail',
      title: 'Mail',
      icon: () => null,
      rootSheet: () => this._mailRootSheet || WorkspaceStore.Sheet.Threads,
    };
  }

  /** Replaces the placeholder mail declaration with the dock's real title and icon. */
  setMailPresentation(title: string, icon: React.ComponentType) {
    this._sections = this._sections.map((s) => (s.id === 'mail' ? { ...s, title, icon } : s));
    this.trigger();
  }

  _onSelectSection = (id: SectionId) => {
    if (id === this._current) {
      return;
    }
    const target = this._sections.find((s) => s.id === id);
    if (!target) {
      console.warn(`SectionStore: unknown section "${id}"`);
      return;
    }

    if (this._current === 'mail') {
      this._mailRootSheet = WorkspaceStore.rootSheet();
    }

    this._restoreMenus();
    this._current = id;
    Actions.selectRootSheet(target.rootSheet());
    this._applyMenus(target);
    target.onEnter?.();
    this.trigger();
  };

  _applyMenus(section: SectionDeclaration) {
    if (!section.menu && !section.hiddenMenuIds?.length) {
      return;
    }
    const template = AppEnv.menu.template;
    const hidden = new Set(section.hiddenMenuIds || []);
    this._stashedMenus = template
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => hidden.has(item.id));
    const kept = template.filter((item) => !hidden.has(item.id));
    if (section.menu) {
      const editIndex = kept.findIndex((item) => item.id === 'Edit');
      kept.splice(editIndex + 1, 0, section.menu);
      this._insertedMenuId = section.menu.id;
    }
    AppEnv.menu.template = kept;
    AppEnv.menu.update();
  }

  _restoreMenus() {
    if (!this._insertedMenuId && this._stashedMenus.length === 0) {
      return;
    }
    const template = AppEnv.menu.template.filter((item) => item.id !== this._insertedMenuId);
    for (const { index, item } of this._stashedMenus) {
      template.splice(Math.min(index, template.length), 0, item);
    }
    this._stashedMenus = [];
    this._insertedMenuId = null;
    AppEnv.menu.template = template;
    AppEnv.menu.update();
  }

  _resetForSpecs() {
    this._restoreMenus();
    this._sections = [this._mailSection()];
    this._current = 'mail';
    this._mailRootSheet = null;
  }
}

export default new SectionStore();
