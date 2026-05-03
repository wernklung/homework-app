const router = require('express').Router();
const db = require('../db/database');
const { authenticate, requireTutor } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM topics ORDER BY name').all());
});

router.post('/', authenticate, requireTutor, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO topics (name, color) VALUES (?, ?)').run(name.trim(), color || '#4F46E5');
  res.json({ id: r.lastInsertRowid, name: name.trim(), color: color || '#4F46E5' });
});

router.delete('/:id', authenticate, requireTutor, (req, res) => {
  db.prepare('DELETE FROM topics WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
