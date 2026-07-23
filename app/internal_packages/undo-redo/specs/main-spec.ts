import { ComponentRegistry } from 'mailspring-exports';
import { activate, deactivate } from '../lib/main';
import UndoRedoToast from '../lib/undo-redo-toast';

describe('undo-redo main', () => {
  afterEach(() => {
    // Leave no registration behind between specs regardless of assertions below.
    ComponentRegistry.unregister(UndoRedoToast);
  });

  describe('activate', () => {
    it('registers the toast in the main window', () => {
      spyOn(AppEnv, 'isMainWindow').andReturn(true);
      spyOn(AppEnv, 'getLoadSettings').andReturn({ windowType: 'default' });
      const register = spyOn(ComponentRegistry, 'register');

      activate();

      expect(register).toHaveBeenCalled();
      expect(register.calls[0].args[0]).toBe(UndoRedoToast);
    });

    it('registers the toast in a composer window', () => {
      spyOn(AppEnv, 'isMainWindow').andReturn(false);
      spyOn(AppEnv, 'getLoadSettings').andReturn({ windowType: 'composer' });
      const register = spyOn(ComponentRegistry, 'register');

      activate();

      expect(register).toHaveBeenCalled();
    });

    it('does not register the toast in a thread-popout window', () => {
      spyOn(AppEnv, 'isMainWindow').andReturn(false);
      spyOn(AppEnv, 'getLoadSettings').andReturn({ windowType: 'thread-popout' });
      const register = spyOn(ComponentRegistry, 'register');

      activate();

      expect(register).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('unregisters the toast in a composer window', () => {
      spyOn(AppEnv, 'isMainWindow').andReturn(false);
      spyOn(AppEnv, 'getLoadSettings').andReturn({ windowType: 'composer' });
      const unregister = spyOn(ComponentRegistry, 'unregister');

      deactivate();

      expect(unregister).toHaveBeenCalledWith(UndoRedoToast);
    });
  });
});
