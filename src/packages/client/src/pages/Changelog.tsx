import { useState, useEffect } from 'preact/hooks';
import { Spinner } from '@/components/common/Spinner';
import styles from './Changelog.module.scss';

interface ChangelogProps {
	path?: string;
}

const CHANGELOG_URL = 'https://raw.githubusercontent.com/rw3iss/mu/main/CHANGELOG.md';

interface ChangeEntry {
	heading: string;
	content: string;
}

function parseChangelog(markdown: string): ChangeEntry[] {
	const lines = markdown.split('\n');
	const entries: ChangeEntry[] = [];
	let currentHeading = '';
	let currentLines: string[] = [];

	for (const line of lines) {
		// Match ## headings (version sections)
		if (line.startsWith('## ')) {
			if (currentHeading) {
				entries.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
			}
			currentHeading = line.replace(/^##\s+/, '');
			currentLines = [];
		} else if (currentHeading) {
			currentLines.push(line);
		}
	}

	// Push the last entry
	if (currentHeading) {
		entries.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
	}

	return entries;
}

function renderContent(content: string) {
	// Simple markdown-to-HTML for list items and paragraphs
	const lines = content.split('\n');
	const elements: preact.VNode[] = [];
	let listItems: string[] = [];

	function flushList() {
		if (listItems.length > 0) {
			elements.push(
				<ul class={styles.list}>
					{listItems.map((item, i) => (
						<li key={i} class={styles.listItem}>
							{item}
						</li>
					))}
				</ul>,
			);
			listItems = [];
		}
	}

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
			listItems.push(trimmed.replace(/^[-*]\s+/, ''));
		} else if (trimmed.startsWith('### ')) {
			flushList();
			elements.push(<h4 class={styles.subHeading}>{trimmed.replace(/^###\s+/, '')}</h4>);
		} else if (trimmed) {
			flushList();
			elements.push(<p class={styles.paragraph}>{trimmed}</p>);
		}
	}
	flushList();

	return elements;
}

export function Changelog(_props: ChangelogProps) {
	const [entries, setEntries] = useState<ChangeEntry[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		async function fetchChangelog() {
			try {
				const response = await fetch(CHANGELOG_URL);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const text = await response.text();
				const parsed = parseChangelog(text);
				setEntries(parsed);
			} catch {
				setError('No changes found.');
			} finally {
				setIsLoading(false);
			}
		}
		fetchChangelog();
	}, []);

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>Changelog</h1>
			<p class={styles.subtitle}>Recent changes and updates to Mu</p>

			{isLoading && (
				<div class={styles.loading}>
					<Spinner size="md" />
				</div>
			)}

			{error && <div class={styles.empty}>{error}</div>}

			{!isLoading && !error && entries.length === 0 && (
				<div class={styles.empty}>No changes found.</div>
			)}

			{!isLoading && entries.length > 0 && (
				<div class={styles.entries}>
					{entries.map((entry, i) => (
						<div key={i} class={styles.entry}>
							<h3 class={styles.entryHeading}>{entry.heading}</h3>
							<div class={styles.entryContent}>{renderContent(entry.content)}</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
