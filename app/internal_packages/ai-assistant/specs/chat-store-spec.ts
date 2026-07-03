import fs from 'fs';
import os from 'os';
import path from 'path';
import Sqlite3 from 'better-sqlite3';
import { ChatStore, migrateChats } from '../lib/chat-store';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ms-chatstore-'));
}

function seedLegacy(dir: string, rows: Array<[string, string, string]>): string {
  const p = path.join(dir, 'ai-index.db');
  const db = new Sqlite3(p);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, role TEXT, content TEXT, createdAt INTEGER);
    CREATE TABLE IF NOT EXISTS chat_refs (chatId INTEGER, messageId TEXT, threadId TEXT);
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, messageId TEXT);
  `);
  const ins = db.prepare('INSERT INTO chats (threadId, role, content, createdAt) VALUES (?,?,?,?)');
  for (const [t, r, c] of rows) ins.run(t, r, c, Date.now());
  db.close();
  return p;
}

describe('migrateChats', () => {
  it('copies legacy chats into the new DB and drops the legacy tables', () => {
    const dir = tmpDir();
    const legacy = seedLegacy(dir, [
      ['s1', 'user', 'hello'],
      ['s1', 'assistant', 'hi'],
    ]);
    const newPath = path.join(dir, 'ai-chat.db');
    expect(migrateChats(newPath, legacy)).toBe('migrated');

    const newDb = new Sqlite3(newPath);
    expect((newDb.prepare('SELECT COUNT(*) c FROM chats').get() as any).c).toBe(2);
    newDb.close();

    const old = new Sqlite3(legacy);
    const t = old
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='chats'`)
      .get();
    expect(t).toBeUndefined();
    // vector tables untouched
    const chunks = old
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'`)
      .get();
    expect(chunks).toBeDefined();
    old.close();
  });

  it('is a no-op when the legacy DB is missing or already migrated', () => {
    const dir = tmpDir();
    const newPath = path.join(dir, 'ai-chat.db');
    expect(migrateChats(newPath, path.join(dir, 'nope.db'))).toBe('none');
    const legacy = seedLegacy(dir, [['s1', 'user', 'x']]);
    expect(migrateChats(newPath, legacy)).toBe('migrated');
    expect(migrateChats(newPath, legacy)).toBe('none'); // legacy tables gone now
  });

  it('recovers from a partial copy by wiping and re-copying', () => {
    const dir = tmpDir();
    const legacy = seedLegacy(dir, [
      ['s1', 'user', 'a'],
      ['s1', 'assistant', 'b'],
      ['s2', 'user', 'c'],
    ]);
    const newPath = path.join(dir, 'ai-chat.db');
    // simulate a partial copy: 1 of 3 rows landed
    const nd = new Sqlite3(newPath);
    nd.exec(`
      CREATE TABLE chats (id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT, role TEXT, content TEXT, createdAt INTEGER);
      CREATE TABLE chat_refs (chatId INTEGER, messageId TEXT, threadId TEXT);
    `);
    nd.prepare('INSERT INTO chats (threadId, role, content, createdAt) VALUES (?,?,?,?)').run(
      's1',
      'user',
      'a',
      1
    );
    nd.close();
    expect(migrateChats(newPath, legacy)).toBe('migrated');
    const check = new Sqlite3(newPath);
    expect((check.prepare('SELECT COUNT(*) c FROM chats').get() as any).c).toBe(3);
    check.close();
  });
});

describe('ChatStore with legacy path', () => {
  it('opens the new DB and reads migrated history', () => {
    const dir = tmpDir();
    const legacy = seedLegacy(dir, [['sX', 'user', 'migrated message']]);
    const store = new ChatStore(path.join(dir, 'ai-chat.db'), legacy);
    const hist = store.history('sX');
    expect(hist.length).toBe(1);
    expect(hist[0].content).toBe('migrated message');
    store.close();
  });
});
