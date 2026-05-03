const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/database');

async function main() {
  await initDatabase();

  const app = express();
  app.use(express.json());

  // When DATA_DIR is set (cloud deployment), serve uploads from there.
  // Locally, Express static middleware serves public/uploads automatically.
  if (process.env.DATA_DIR) {
    const uploadsDir = path.join(process.env.DATA_DIR, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    app.use('/uploads', express.static(uploadsDir));
  }

  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/topics', require('./routes/topics'));
  app.use('/api/assignments', require('./routes/assignments'));

  app.get('/tutor',  (_, res) => res.sendFile(path.join(__dirname, 'public', 'tutor.html')));
  app.get('/student',(_, res) => res.sendFile(path.join(__dirname, 'public', 'student.html')));
  app.get('*',       (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Homework App running at http://localhost:${PORT}`);
    console.log('  Default tutor: username=tutor  password=tutor123\n');
  });
}

main().catch(err => { console.error('Startup error:', err); process.exit(1); });
