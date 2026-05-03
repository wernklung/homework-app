const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hw-app-secret-change-in-production';

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireTutor(req, res, next) {
  if (req.user.role !== 'tutor') return res.status(403).json({ error: 'Tutor access required' });
  next();
}

module.exports = { authenticate, requireTutor, JWT_SECRET };
