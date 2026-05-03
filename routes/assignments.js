const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { authenticate, requireTutor } = require('../middleware/auth');

const UPLOADS_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(__dirname, '../public/uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

function attachFiles(assignments) {
  return assignments.map(a => ({
    ...a,
    files: db.all('SELECT * FROM assignment_files WHERE assignment_id = ? ORDER BY uploaded_at', [a.id]),
  }));
}

function attachSubmissions(assignments, studentId) {
  return assignments.map(a => ({
    ...a,
    submissions: db.all(
      'SELECT * FROM submission_files WHERE assignment_id = ? AND student_id = ? ORDER BY uploaded_at',
      [a.id, studentId]
    ),
  }));
}

// GET assignments — tutor sees all (filterable), student sees only theirs
router.get('/', authenticate, (req, res) => {
  const { student_id, topic_id, class_year, status } = req.query;

  if (req.user.role === 'student') {
    const params = [req.user.id];
    let q = `
      SELECT a.*, t.name AS topic_name, t.color AS topic_color,
             s.is_completed, s.completed_at, s.notes, s.grade, s.feedback
      FROM assignments a
      LEFT JOIN topics t ON a.topic_id = t.id
      JOIN assignment_students s ON a.id = s.assignment_id
      WHERE s.student_id = ?`;
    if (topic_id) { q += ' AND a.topic_id = ?'; params.push(topic_id); }
    if (status === 'completed') q += ' AND s.is_completed = 1';
    if (status === 'pending')   q += ' AND s.is_completed = 0';
    q += ' ORDER BY a.due_date ASC, a.created_at DESC';
    return res.json(attachSubmissions(attachFiles(db.all(q, params)), req.user.id));
  }

  // Tutor view
  const params = [];
  let q = `
    SELECT a.*, t.name AS topic_name, t.color AS topic_color,
           GROUP_CONCAT(u.id || '::' || u.name || '::' || u.class_year || '::' || COALESCE(s.is_completed, 0), '|||') AS students_raw
    FROM assignments a
    LEFT JOIN topics t ON a.topic_id = t.id
    LEFT JOIN assignment_students s ON a.id = s.assignment_id
    LEFT JOIN users u ON s.student_id = u.id
    WHERE 1=1`;
  if (topic_id)   { q += ' AND a.topic_id = ?';  params.push(topic_id); }
  if (class_year) { q += ' AND a.class_year = ?'; params.push(class_year); }
  if (student_id) { q += ' AND s.student_id = ?'; params.push(student_id); }
  if (status === 'completed') q += ' AND s.is_completed = 1';
  if (status === 'pending')   q += ' AND s.is_completed = 0';
  q += ' GROUP BY a.id ORDER BY a.due_date ASC, a.created_at DESC';

  const rows = db.all(q, params).map(r => ({
    ...r,
    students: r.students_raw
      ? r.students_raw.split('|||').map(s => {
          const [id, name, class_year, done] = s.split('::');
          return { id: Number(id), name, class_year: class_year === 'null' ? null : class_year, is_completed: done === '1' };
        })
      : [],
  }));
  res.json(attachFiles(rows));
});

// POST create assignment (tutor only)
router.post('/', authenticate, requireTutor, (req, res) => {
  const { title, description, topic_id, due_date, class_year, student_ids } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const r = db.prepare(
    'INSERT INTO assignments (title, description, topic_id, due_date, class_year, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title, description || null, topic_id || null, due_date || null, class_year || null, req.user.id);

  const aid = r.lastInsertRowid;
  let targets = student_ids && student_ids.length ? student_ids : [];
  if (class_year && !targets.length) {
    targets = db.all("SELECT id FROM users WHERE role='student' AND class_year=?", [class_year]).map(s => s.id);
  }
  for (const sid of targets) {
    db.run('INSERT OR IGNORE INTO assignment_students (assignment_id, student_id) VALUES (?, ?)', [aid, sid]);
  }
  res.json({ id: aid, success: true });
});

// PUT update assignment (tutor only)
router.put('/:id', authenticate, requireTutor, (req, res) => {
  const { title, description, topic_id, due_date } = req.body;
  db.prepare('UPDATE assignments SET title=?, description=?, topic_id=?, due_date=? WHERE id=?')
    .run(title, description || null, topic_id || null, due_date || null, req.params.id);
  res.json({ success: true });
});

// DELETE assignment (tutor only)
router.delete('/:id', authenticate, requireTutor, (req, res) => {
  // Delete physical files first
  const files = db.all('SELECT filename FROM assignment_files WHERE assignment_id = ?', [req.params.id]);
  for (const f of files) {
    const fp = path.join(UPLOADS_DIR, f.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// GET all students for an assignment with their completion + grade + submissions (tutor only)
router.get('/:id/students', authenticate, requireTutor, (req, res) => {
  const students = db.all(`
    SELECT u.id, u.name, u.username, u.class_year,
           s.is_completed, s.completed_at, s.notes, s.grade, s.feedback
    FROM assignment_students s
    JOIN users u ON s.student_id = u.id
    WHERE s.assignment_id = ?
    ORDER BY u.class_year, u.name
  `, [req.params.id]);

  const allSubs = db.all('SELECT * FROM submission_files WHERE assignment_id = ? ORDER BY uploaded_at', [req.params.id]);
  const byStudent = {};
  for (const f of allSubs) {
    if (!byStudent[f.student_id]) byStudent[f.student_id] = [];
    byStudent[f.student_id].push(f);
  }
  res.json(students.map(s => ({ ...s, submissions: byStudent[s.id] || [] })));
});

// PUT save grade + feedback for one student (tutor only)
router.put('/:id/grade/:studentId', authenticate, requireTutor, (req, res) => {
  const { grade, feedback } = req.body;
  db.prepare('UPDATE assignment_students SET grade=?, feedback=? WHERE assignment_id=? AND student_id=?')
    .run(grade || null, feedback || null, req.params.id, req.params.studentId);
  res.json({ success: true });
});

// PUT student marks complete/incomplete
router.put('/:id/complete', authenticate, (req, res) => {
  const { is_completed, notes } = req.body;
  const completed_at = is_completed ? new Date().toISOString() : null;
  db.prepare('UPDATE assignment_students SET is_completed=?, completed_at=?, notes=? WHERE assignment_id=? AND student_id=?')
    .run(is_completed ? 1 : 0, completed_at, notes || null, req.params.id, req.user.id);
  res.json({ success: true });
});

// POST student submits work files
router.post('/:id/submit', authenticate, upload.array('files', 20), (req, res) => {
  if (!req.files || !req.files.length) return res.json({ success: true });
  for (const file of req.files) {
    db.run(
      'INSERT INTO submission_files (assignment_id, student_id, filename, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, file.filename, file.originalname, file.mimetype, file.size]
    );
  }
  res.json({ success: true });
});

// DELETE student removes their own submission file
router.delete('/:id/submit/:fileId', authenticate, (req, res) => {
  const file = db.get(
    'SELECT * FROM submission_files WHERE id = ? AND assignment_id = ? AND student_id = ?',
    [req.params.fileId, req.params.id, req.user.id]
  );
  if (file) {
    const fp = path.join(UPLOADS_DIR, file.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.run('DELETE FROM submission_files WHERE id = ?', [req.params.fileId]);
  }
  res.json({ success: true });
});

// POST upload files to an assignment (tutor only)
router.post('/:id/files', authenticate, requireTutor, upload.array('files', 20), (req, res) => {
  if (!req.files || !req.files.length) return res.json({ success: true });
  for (const file of req.files) {
    db.run(
      'INSERT INTO assignment_files (assignment_id, filename, original_name, mimetype, size) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, file.filename, file.originalname, file.mimetype, file.size]
    );
  }
  res.json({ success: true });
});

// DELETE a file from an assignment (tutor only)
router.delete('/:id/files/:fileId', authenticate, requireTutor, (req, res) => {
  const file = db.get('SELECT * FROM assignment_files WHERE id = ? AND assignment_id = ?', [req.params.fileId, req.params.id]);
  if (file) {
    const fp = path.join(UPLOADS_DIR, file.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.run('DELETE FROM assignment_files WHERE id = ?', [req.params.fileId]);
  }
  res.json({ success: true });
});

module.exports = router;
