#!/usr/bin/env node
/**
 * Manage server settings from the command line (outside the running process).
 *
 * Usage:
 *   node scripts/settings.js                     # list all settings
 *   node scripts/settings.js get <key>            # get a setting
 *   node scripts/settings.js set <key> <value>    # set a setting (JSON values supported)
 *   node scripts/settings.js delete <key>         # delete a setting
 *
 * Examples:
 *   node scripts/settings.js get hwAccelBroken
 *   node scripts/settings.js set hwAccelBroken false
 *   node scripts/settings.js delete hwAccelBroken
 *   node scripts/settings.js set encoding '{"hwAccel":"nvenc","preset":"veryfast"}'
 */
const path = require('path');
const fs = require('fs');

const dbPaths = [
	path.resolve(__dirname, '..', 'packages', 'server', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', 'data', 'db', 'mu.db'),
	path.resolve(__dirname, '..', '..', 'data', 'db', 'mu.db'),
];
const dbPath = dbPaths.find(fs.existsSync);
if (!dbPath) { console.error('Database not found'); process.exit(1); }

const Database = require('better-sqlite3');
const db = new Database(dbPath);

const [,, command, key, ...rest] = process.argv;
const value = rest.join(' ');

switch (command) {
	case 'get': {
		if (!key) { console.error('Usage: settings.js get <key>'); process.exit(1); }
		const row = db.prepare('SELECT key, value, updated_at FROM settings WHERE key = ?').get(key);
		if (!row) { console.log(`(not set)`); break; }
		try {
			const parsed = JSON.parse(row.value);
			console.log(JSON.stringify(parsed, null, 2));
		} catch {
			console.log(row.value);
		}
		break;
	}
	case 'set': {
		if (!key || !value) { console.error('Usage: settings.js set <key> <value>'); process.exit(1); }
		// Try to parse as JSON, fall back to string
		let stored = value;
		try { JSON.parse(value); stored = value; } catch { stored = JSON.stringify(value); }
		const now = new Date().toISOString();
		db.prepare(
			'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?',
		).run(key, stored, now, stored, now);
		console.log(`${key} = ${stored}`);
		break;
	}
	case 'delete':
	case 'rm': {
		if (!key) { console.error('Usage: settings.js delete <key>'); process.exit(1); }
		const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key);
		console.log(result.changes ? `Deleted ${key}` : `${key} not found`);
		break;
	}
	default: {
		// List all settings
		const rows = db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
		if (rows.length === 0) { console.log('No settings'); break; }
		for (const row of rows) {
			let display = row.value;
			try {
				const parsed = JSON.parse(display);
				if (typeof parsed === 'object') display = JSON.stringify(parsed);
			} catch {}
			console.log(`  ${row.key} = ${display}`);
		}
		break;
	}
}

db.close();
