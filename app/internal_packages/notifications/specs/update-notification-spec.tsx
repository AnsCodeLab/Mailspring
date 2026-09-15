import { render, fireEvent, cleanup } from '@testing-library/react';
import proxyquire from 'proxyquire';
import React from 'react';

let stubUpdaterState = null;
let stubUpdaterReleaseVersion = null;
let stubUpdaterReleaseNotes = null;
let ipcSendArgs = null;

const patched = proxyquire('../lib/items/update-notification', {
  electron: {
    ipcRenderer: {
      send: (...args) => {
        ipcSendArgs = args;
      },
    },
  },
  '@electron/remote': {
    getGlobal: () => ({
      autoUpdateManager: {
        get releaseVersion() {
          return stubUpdaterReleaseVersion;
        },
        getState: () => stubUpdaterState,
        getReleaseDetails: () => ({
          releaseVersion: stubUpdaterReleaseVersion,
          releaseNotes: stubUpdaterReleaseNotes,
        }),
      },
    }),
  },
});

const UpdateNotification = patched.default;

describe('UpdateNotification', function describeBlock() {
  afterEach(cleanup);

  beforeEach(() => {
    stubUpdaterState = 'idle';
    stubUpdaterReleaseVersion = undefined;
    stubUpdaterReleaseNotes = 'A new version is available!';
    ipcSendArgs = null;
  });

  describe('mounting', () => {
    it('should display a notification immediately if one is available', () => {
      stubUpdaterState = 'update-available';
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector('.notification') !== null).toEqual(true);
    });

    it('should not display a notification if no update is avialable', () => {
      stubUpdaterState = 'no-update-available';
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector('.notification') !== null).toEqual(false);
    });

    it('should listen for `window:update-available`', () => {
      spyOn(AppEnv, 'onUpdateAvailable').andCallThrough();
      render(<UpdateNotification />);
      expect(AppEnv.onUpdateAvailable).toHaveBeenCalled();
    });
  });

  describe('displayNotification', () => {
    it('should include the version if one is provided', () => {
      stubUpdaterState = 'update-available';
      stubUpdaterReleaseVersion = '0.515.0-123123';
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector('.title').textContent.indexOf('0.515.0-123123') >= 0).toBe(
        true
      );
    });

    it('shows the "Install" action label by default (no "manual download" sentinel branch anymore)', () => {
      stubUpdaterState = 'update-available';
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector('#action-0').textContent).toEqual('Install');
    });

    it('shows an inline preview of the real release notes body', () => {
      stubUpdaterState = 'update-available';
      stubUpdaterReleaseNotes = 'Fixed a crash on startup and improved sync reliability.';
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector('.notification-body').textContent).toEqual(
        'Fixed a crash on startup and improved sync reliability.'
      );
    });

    it('truncates a long release notes body to roughly 200 characters', () => {
      stubUpdaterState = 'update-available';
      stubUpdaterReleaseNotes = 'x'.repeat(500);
      const { container } = render(<UpdateNotification />);
      const previewText = container.querySelector('.notification-body').textContent;
      expect(previewText.length).toBeLessThan(210);
      expect(previewText.endsWith('…')).toBe(true);
    });

    it('renders no preview element when there are no release notes', () => {
      stubUpdaterState = 'update-available';
      stubUpdaterReleaseNotes = '';
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector('.notification-body')).toBeNull();
    });

    describe('when the action is taken', () => {
      it('should fire the `application:install-update` IPC event', () => {
        stubUpdaterState = 'update-available';
        const { container } = render(<UpdateNotification />);
        fireEvent.click(container.querySelector('#action-0'));
        expect(ipcSendArgs).toEqual(['command', 'application:install-update']);
      });

      it('switches the action label to "Installing…" once clicked', () => {
        stubUpdaterState = 'update-available';
        const { container } = render(<UpdateNotification />);
        fireEvent.click(container.querySelector('#action-0'));
        expect(container.querySelector('#action-0').textContent).toEqual('Installing…');
      });

      it('does not re-send the IPC command on a second click while installing', () => {
        stubUpdaterState = 'update-available';
        const { container } = render(<UpdateNotification />);
        fireEvent.click(container.querySelector('#action-0'));
        ipcSendArgs = null;
        fireEvent.click(container.querySelector('#action-0'));
        expect(ipcSendArgs).toBeNull();
      });

      it('should dismiss the update notification prompt', () => {
        stubUpdaterState = 'update-available';
        const { container } = render(<UpdateNotification />);
        expect(container.querySelector('.notification') !== null).toEqual(true);
        fireEvent.click(container.querySelector('#action-1'));
        expect(container.querySelector('.notification') !== null).toEqual(false);
      });
    });
  });
});
