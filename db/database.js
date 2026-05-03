const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'homework.db')
  : path.join(__dirname, 'homework.db');
let _db = null;

function persist(sqlDb) {
  if (process.env.DATA_DIR) fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export()));
}

// Wraps a sql.js Database instance in a better-sqlite3-compatible synchronous API
function makeWrapper(sqlDb) {
  const w = {
    exec(sql) {
      sqlDb.exec(sql);
      persist(sqlDb);
    },

    run(sql, params) {
      sqlDb.run(sql, params || []);
      const rid = sqlDb.exec('SELECT last_insert_rowid()');
      const lastInsertRowid = rid[0]?.values[0][0] ?? 0;
      const changes = sqlDb.getRowsModified();
      persist(sqlDb);
      return { lastInsertRowid, changes };
    },

    get(sql, params) {
      const stmt = sqlDb.prepare(sql);
      if (params && params.length) stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : undefined;
      stmt.free();
      return row;
    },

    all(sql, params) {
      const stmt = sqlDb.prepare(sql);
      if (params && params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },

    // Returns an object whose .run/.get/.all spread args into the underlying methods
    // so existing route code like db.prepare(sql).run(p1, p2) works unchanged
    prepare(sql) {
      const self = this;
      return {
        run(...args) {
          return self.run(sql, args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
        },
        get(...args) {
          return self.get(sql, args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
        },
        all(...args) {
          return self.all(sql, args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
        },
      };
    },
  };
  return w;
}

async function initDatabase() {
  const SQL = await initSqlJs();

  const sqlDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  sqlDb.run('PRAGMA foreign_keys = ON');

  const db = makeWrapper(sqlDb);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      class_year TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#4F46E5',
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
      due_date DATE,
      class_year TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assignment_students (
      assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
      student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      is_completed INTEGER DEFAULT 0,
      completed_at DATETIME,
      notes TEXT,
      PRIMARY KEY (assignment_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS assignment_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype TEXT,
      size INTEGER,
      uploaded_at DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Safe migrations — add columns to existing databases without failing if they already exist
  try { sqlDb.run('ALTER TABLE assignment_students ADD COLUMN grade TEXT'); } catch (_) {}
  try { sqlDb.run('ALTER TABLE assignment_students ADD COLUMN feedback TEXT'); } catch (_) {}
  persist(sqlDb);

  const tutorExists = db.get("SELECT id FROM users WHERE role = 'tutor' LIMIT 1");
  if (!tutorExists) {
    const hash = bcrypt.hashSync('tutor123', 10);
    db.prepare("INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'tutor', ?)").run('tutor', hash, 'Tutor');
    console.log('Default tutor account created — username: tutor  password: tutor123');
  }

  _db = db;
  return db;
}

// Proxy so routes can `const db = require('../db/database')` and use it normally —
// property access is forwarded to _db once initDatabase() has been called.
const proxy = new Proxy({}, {
  get(_, prop) {
    if (prop === 'initDatabase') return initDatabase;
    if (!_db) throw new Error('Database not initialised — initDatabase() must complete first');
    const val = _db[prop];
    return typeof val === 'function' ? val.bind(_db) : val;
  },
});

module.exports = proxy;
