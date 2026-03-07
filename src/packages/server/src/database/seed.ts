import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.MU_DATABASE_SQLITE_PATH
  || resolve(__dirname, '../../../../data/db/mu.db');

// Ensure directory exists
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const now = new Date().toISOString();

// Default admin user
const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'password';
const email = process.argv[4] || null;

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

if (existing) {
  console.log(`User "${username}" already exists — skipping.`);
} else {
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', ?, ?)
  `).run(id, username, email, passwordHash, now, now);

  console.log(`Created admin user "${username}" with password "${password}".`);
}

db.close();
