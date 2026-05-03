const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { authenticate, requireTutor } = require('../middleware/auth');

router.get('/students', authenticate, requireTutor, (req, res) => {
  const { class_year } = req.query;
  const params = ['student'];
  let q = 'SELECT id, username, name, class_year, created_at FROM users WHERE role = ?';
  if (class_year) { q += ' AND class_year = ?'; params.push(class_year); }
  q += ' ORDER BY class_year, name';
  res.json(db.prepare(q).all(...params));
});

router.post('/students', authenticate, requireTutor, (req, res) => {
  const { username, password, name, class_year } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'username, password and name are required' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare("INSERT INTO users (username, password_hash, role, name, class_year) VALUES (?, ?, 'student', ?, ?)").run(username, hash, name, class_year || null);
    res.json({ id: r.lastInsertRowid, username, name, class_year: class_year || null });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

router.put('/students/:id', authenticate, requireTutor, (req, res) => {
  const { name, class_year, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET name=?, class_year=?, password_hash=? WHERE id=? AND role='student'").run(name, class_year || null, hash, req.params.id);
  } else {
    db.prepare("UPDATE users SET name=?, class_year=? WHERE id=? AND role='student'").run(name, class_year || null, req.params.id);
  }
  res.json({ success: true });
});

router.delete('/students/:id', authenticate, requireTutor, (req, res) => {
  db.prepare("DELETE FROM users WHERE id=? AND role='student'").run(req.params.id);
  res.json({ success: true });
});

router.get('/class-years', authenticate, (req, res) => {
  const rows = db.prepare("SELECT DISTINCT class_year FROM users WHERE role='student' AND class_year IS NOT NULL ORDER BY class_year").all();
  res.json(rows.map(r => r.class_year));
});

module.exports = router;
