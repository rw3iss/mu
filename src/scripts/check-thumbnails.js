const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database('D:/.mu_data/db/mu.db');

const total = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;
const withUrl = db.prepare("SELECT COUNT(*) as c FROM movies WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''").get().c;
console.log(`Total movies: ${total}, With thumbnail URL: ${withUrl}, Without: ${total - withUrl}`);

// Sample thumbnail URLs to understand the pattern
const samples = db.prepare('SELECT id, thumbnail_url FROM movies WHERE thumbnail_url IS NOT NULL LIMIT 5').all();
console.log('\nSample URLs:');
samples.forEach(s => console.log(`  ${s.id} -> ${s.thumbnail_url}`));

// Find the thumbnail directory by checking common locations
const candidates = [
	'D:/.mu_data/thumbnails',
	'./data/thumbnails',
	'../data/thumbnails',
	path.resolve(__dirname, '../../data/thumbnails'),
	path.resolve(__dirname, '../../../data/thumbnails'),
];
let thumbDir = null;
for (const d of candidates) {
	if (fs.existsSync(d)) {
		thumbDir = d;
		const files = fs.readdirSync(d);
		console.log(`\nThumbnail dir: ${d} (${files.length} files)`);
		if (files.length > 0) console.log('  Sample:', files.slice(0, 3).join(', '));
		break;
	}
}
if (!thumbDir) console.log('\nNo thumbnail directory found in candidates:', candidates);

// Check the specific broken thumbnail
const broken = db.prepare("SELECT id, title, thumbnail_url FROM movies WHERE id = 'f53c53f6-3888-44f4-85d3-76fe39c62e60'").get();
if (broken) {
	console.log(`\nBroken movie: "${broken.title}"`);
	console.log(`  URL: ${broken.thumbnail_url}`);
	// Extract filename from URL
	if (broken.thumbnail_url) {
		const match = broken.thumbnail_url.match(/thumbnails\/([^?]+)/);
		if (match && thumbDir) {
			const filePath = path.join(thumbDir, match[1]);
			console.log(`  File: ${filePath}`);
			console.log(`  Exists: ${fs.existsSync(filePath)}`);
		}
	}
}

// Count how many movies have a thumbnail URL but the file is missing
if (thumbDir) {
	const allWithUrl = db.prepare("SELECT id, thumbnail_url FROM movies WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''").all();
	let missing = 0;
	let exists = 0;
	for (const m of allWithUrl) {
		const match = m.thumbnail_url.match(/thumbnails\/([^?]+)/);
		if (match) {
			const filePath = path.join(thumbDir, match[1]);
			if (fs.existsSync(filePath)) exists++;
			else missing++;
		}
	}
	console.log(`\nThumbnail file check: ${exists} exist, ${missing} MISSING on disk`);
}

db.close();
