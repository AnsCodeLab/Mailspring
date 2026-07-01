type Listener = () => void;

class ChatActivityStoreImpl {
  private _listeners = new Set<Listener>();
  private _active = new Set<string>();
  private _withHistory = new Set<string>();

  setActive(threadId: string, active: boolean) {
    if (active) this._active.add(threadId);
    else this._active.delete(threadId);
    this._notify();
  }

  setHasHistory(threadId: string, has: boolean) {
    if (has) this._withHistory.add(threadId);
    else this._withHistory.delete(threadId);
    this._notify();
  }

  isActive(threadId: string) {
    return this._active.has(threadId);
  }

  hasHistory(threadId: string) {
    return this._withHistory.has(threadId);
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    this._listeners.forEach((fn) => fn());
  }
}

export const ChatActivityStore = new ChatActivityStoreImpl();
