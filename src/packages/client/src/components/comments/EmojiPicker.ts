/**
 * EmojiPicker — ported from the Pageloop widget (vanilla DOM, body-mounted,
 * anchor-positioned, Escape/outside-click dismiss). "Recent" tab doubles as
 * the user's favourites — an MRU persisted in localStorage so the same list
 * follows them across every reaction surface.
 */

function safeGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function safeSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* private mode */
	}
}

let stylesInjected = false;
function injectStyles(): void {
	if (stylesInjected || typeof document === 'undefined') return;
	stylesInjected = true;
	const el = document.createElement('style');
	el.textContent = `
.mu-emoji-picker{position:fixed;z-index:10000;width:300px;display:flex;flex-direction:column;background:var(--color-bg-surface,#1c1c22);border:1px solid var(--color-border,rgba(255,255,255,.12));border-radius:var(--radius-md,8px);box-shadow:0 8px 28px rgba(0,0,0,.5);overflow:hidden}
.mu-emoji-picker__tabs{display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--color-border,rgba(255,255,255,.1));overflow-x:auto}
.mu-emoji-picker__tab{font-size:16px;padding:4px 7px;border-radius:6px;background:transparent;border:none;cursor:pointer;opacity:.7}
.mu-emoji-picker__tab:hover{background:var(--color-bg-hover,rgba(255,255,255,.08));opacity:1}
.mu-emoji-picker__tab--on{background:var(--color-bg-hover,rgba(255,255,255,.1));opacity:1}
.mu-emoji-picker__tab:disabled{opacity:.25;cursor:default}
.mu-emoji-picker__grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:8px;overflow-y:auto;max-height:240px}
.mu-emoji-picker__btn{font-size:18px;padding:4px;border-radius:6px;background:transparent;border:none;cursor:pointer;line-height:1.2}
.mu-emoji-picker__btn:hover{background:var(--color-bg-hover,rgba(255,255,255,.1))}
.mu-emoji-picker__empty{grid-column:1/-1;padding:14px;font-size:12px;color:var(--color-text-muted,#888)}
`;
	document.head.appendChild(el);
}

const RECENT_KEY = 'mu_recent_emojis';
const RECENT_MAX = 28;
const SKIN_TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/u;

interface EmojiCategory {
	id: string;
	label: string;
	emoji: string;
	items: string[];
}

/** Curated subset — keeps the bundle size sane while still covering
 *  the obvious "reaction" emojis on every surface. Order within each
 *  category is rough-popular-first. */
const CATEGORIES: EmojiCategory[] = [
	{
		id: 'smileys',
		label: 'Smileys',
		emoji: '😀',
		items: [
			'😀',
			'😃',
			'😄',
			'😁',
			'😆',
			'😅',
			'🤣',
			'😂',
			'🙂',
			'🙃',
			'😉',
			'😊',
			'😇',
			'🥰',
			'😍',
			'🤩',
			'😘',
			'😗',
			'😚',
			'😙',
			'😋',
			'😛',
			'😜',
			'🤪',
			'😝',
			'🤑',
			'🤗',
			'🤭',
			'🤫',
			'🤔',
			'🤐',
			'🤨',
			'😐',
			'😑',
			'😶',
			'😏',
			'😒',
			'🙄',
			'😬',
			'🤥',
			'😌',
			'😔',
			'😪',
			'🤤',
			'😴',
			'😷',
			'🤒',
			'🤕',
			'🤢',
			'🤮',
			'🤧',
			'🥵',
			'🥶',
			'🥴',
			'😵',
			'🤯',
			'🤠',
			'🥳',
			'😎',
			'🤓',
			'🧐',
			'😕',
			'😟',
			'🙁',
			'☹️',
			'😮',
			'😯',
			'😲',
			'😳',
			'🥺',
			'😦',
			'😧',
			'😨',
			'😰',
			'😥',
			'😢',
			'😭',
			'😱',
			'😖',
			'😣',
			'😞',
			'😓',
			'😩',
			'😫',
			'🥱',
			'😤',
			'😡',
			'😠',
			'🤬',
			'😈',
			'👿',
			'💀',
			'☠️',
			'💩',
			'🤡',
			'👹',
			'👺',
			'👻',
			'👽',
			'👾',
			'🤖',
		],
	},
	{
		id: 'people',
		label: 'People',
		emoji: '👋',
		items: [
			'👋',
			'🤚',
			'🖐️',
			'✋',
			'🖖',
			'👌',
			'🤌',
			'🤏',
			'✌️',
			'🤞',
			'🤟',
			'🤘',
			'🤙',
			'👈',
			'👉',
			'👆',
			'🖕',
			'👇',
			'☝️',
			'👍',
			'👎',
			'✊',
			'👊',
			'🤛',
			'🤜',
			'👏',
			'🙌',
			'👐',
			'🤲',
			'🤝',
			'🙏',
			'✍️',
			'💅',
			'🤳',
			'💪',
			'🦾',
			'🦿',
			'🦵',
			'🦶',
			'👂',
			'🦻',
			'👃',
			'🧠',
			'🦷',
			'🦴',
			'👀',
			'👁️',
			'👅',
			'👄',
			'💋',
			'🩸',
			'👶',
			'🧒',
			'👦',
			'👧',
			'🧑',
			'👨',
			'👩',
			'🧓',
			'👴',
			'👵',
		],
	},
	{
		id: 'animals',
		label: 'Animals',
		emoji: '🐶',
		items: [
			'🐶',
			'🐱',
			'🐭',
			'🐹',
			'🐰',
			'🦊',
			'🐻',
			'🐼',
			'🐨',
			'🐯',
			'🦁',
			'🐮',
			'🐷',
			'🐽',
			'🐸',
			'🐵',
			'🙈',
			'🙉',
			'🙊',
			'🐒',
			'🐔',
			'🐧',
			'🐦',
			'🐤',
			'🐣',
			'🐥',
			'🦆',
			'🦅',
			'🦉',
			'🦇',
			'🐺',
			'🐗',
			'🐴',
			'🦄',
			'🐝',
			'🐛',
			'🦋',
			'🐌',
			'🐞',
			'🐜',
			'🦟',
			'🦗',
			'🕷️',
			'🕸️',
			'🦂',
			'🐢',
			'🐍',
			'🦎',
			'🦖',
			'🦕',
			'🐙',
			'🦑',
			'🦐',
			'🦞',
			'🦀',
			'🐡',
			'🐠',
			'🐟',
			'🐬',
			'🐳',
			'🐋',
			'🦈',
			'🐊',
			'🐅',
			'🐆',
			'🦓',
			'🦍',
			'🦧',
			'🐘',
			'🦛',
			'🦏',
			'🐪',
			'🐫',
			'🦒',
			'🦘',
			'🐃',
			'🐂',
			'🐄',
			'🐎',
			'🐖',
			'🐏',
			'🐑',
			'🦙',
			'🐐',
			'🦌',
			'🐕',
			'🐩',
			'🦮',
			'🐈',
			'🐓',
			'🦃',
			'🦚',
			'🦜',
			'🦢',
			'🦩',
			'🕊️',
			'🐇',
			'🦝',
			'🦨',
			'🦡',
			'🦦',
			'🦥',
			'🐁',
			'🐀',
			'🐿️',
			'🦔',
		],
	},
	{
		id: 'food',
		label: 'Food',
		emoji: '🍎',
		items: [
			'🍏',
			'🍎',
			'🍐',
			'🍊',
			'🍋',
			'🍌',
			'🍉',
			'🍇',
			'🍓',
			'🫐',
			'🍈',
			'🍒',
			'🍑',
			'🥭',
			'🍍',
			'🥥',
			'🥝',
			'🍅',
			'🍆',
			'🥑',
			'🥦',
			'🥬',
			'🥒',
			'🌶️',
			'🫑',
			'🌽',
			'🥕',
			'🫒',
			'🧄',
			'🧅',
			'🥔',
			'🍠',
			'🥐',
			'🥯',
			'🍞',
			'🥖',
			'🥨',
			'🧀',
			'🥚',
			'🍳',
			'🧈',
			'🥞',
			'🧇',
			'🥓',
			'🥩',
			'🍗',
			'🍖',
			'🦴',
			'🌭',
			'🍔',
			'🍟',
			'🍕',
			'🥪',
			'🥙',
			'🧆',
			'🌮',
			'🌯',
			'🥗',
			'🥘',
			'🫕',
			'🥫',
			'🍝',
			'🍜',
			'🍲',
			'🍛',
			'🍣',
			'🍱',
			'🥟',
			'🦪',
			'🍤',
			'🍙',
			'🍚',
			'🍘',
			'🍥',
			'🥠',
			'🥮',
			'🍢',
			'🍡',
			'🍧',
			'🍨',
			'🍦',
			'🥧',
			'🧁',
			'🍰',
			'🎂',
			'🍮',
			'🍭',
			'🍬',
			'🍫',
			'🍿',
			'🍩',
			'🍪',
			'🌰',
			'🥜',
			'🍯',
			'🥛',
			'🍼',
			'☕',
			'🫖',
			'🍵',
			'🍶',
			'🍾',
			'🍷',
			'🍸',
			'🍹',
			'🍺',
			'🍻',
			'🥂',
			'🥃',
			'🥤',
			'🧋',
			'🧃',
			'🧉',
			'🧊',
		],
	},
	{
		id: 'activity',
		label: 'Activity',
		emoji: '⚽',
		items: [
			'⚽',
			'🏀',
			'🏈',
			'⚾',
			'🥎',
			'🎾',
			'🏐',
			'🏉',
			'🥏',
			'🎱',
			'🪀',
			'🏓',
			'🏸',
			'🏒',
			'🏑',
			'🥍',
			'🏏',
			'🪃',
			'🥅',
			'⛳',
			'🪁',
			'🏹',
			'🎣',
			'🤿',
			'🥊',
			'🥋',
			'🎽',
			'🛹',
			'🛼',
			'🛷',
			'⛸️',
			'🥌',
			'🎿',
			'⛷️',
			'🏂',
			'🪂',
			'🏋️',
			'🤸',
			'🤺',
			'⛹️',
			'🤾',
			'🏌️',
			'🏇',
			'🧘',
			'🏃',
			'🚶',
			'🧗',
			'🏊',
			'🤽',
			'🚣',
			'🧗',
			'🚵',
			'🚴',
			'🎯',
			'🎳',
			'🎮',
			'🎰',
			'🧩',
			'🎨',
			'✏️',
			'🖊️',
			'📝',
		],
	},
	{
		id: 'travel',
		label: 'Travel',
		emoji: '🚗',
		items: [
			'🚗',
			'🚕',
			'🚙',
			'🚌',
			'🚎',
			'🏎️',
			'🚓',
			'🚑',
			'🚒',
			'🚐',
			'🛻',
			'🚚',
			'🚛',
			'🚜',
			'🦯',
			'🦽',
			'🦼',
			'🛴',
			'🚲',
			'🛵',
			'🏍️',
			'🛺',
			'🚨',
			'🚔',
			'🚍',
			'🚘',
			'🚖',
			'🚡',
			'🚠',
			'🚟',
			'🚃',
			'🚋',
			'🚞',
			'🚝',
			'🚄',
			'🚅',
			'🚈',
			'🚂',
			'🚆',
			'🚇',
			'🚊',
			'🚉',
			'✈️',
			'🛫',
			'🛬',
			'🛩️',
			'💺',
			'🛰️',
			'🚀',
			'🛸',
			'🚁',
			'🛶',
			'⛵',
			'🚤',
			'🛥️',
			'🛳️',
			'⛴️',
			'🚢',
			'⚓',
			'⛽',
			'🚧',
			'🚦',
			'🚥',
			'🚏',
			'🗺️',
			'🗿',
			'🗽',
			'🗼',
			'🏰',
			'🏯',
			'🏟️',
			'🎡',
			'🎢',
			'🎠',
			'⛲',
			'⛱️',
			'🏖️',
			'🏝️',
			'🏜️',
			'🌋',
			'⛰️',
			'🏔️',
			'🗻',
			'🏕️',
			'⛺',
			'🛖',
			'🏠',
			'🏡',
			'🏘️',
			'🏚️',
			'🏗️',
			'🏭',
			'🏢',
			'🏬',
			'🏣',
			'🏤',
			'🏥',
			'🏦',
			'🏨',
			'🏪',
			'🏫',
			'🏩',
			'💒',
			'🏛️',
			'⛪',
			'🕌',
			'🕍',
			'🛕',
			'🕋',
			'⛩️',
		],
	},
	{
		id: 'objects',
		label: 'Objects',
		emoji: '💡',
		items: [
			'💡',
			'🔦',
			'🕯️',
			'🪔',
			'📔',
			'📕',
			'📖',
			'📗',
			'📘',
			'📙',
			'📚',
			'📓',
			'📒',
			'📃',
			'📜',
			'📄',
			'📰',
			'🗞️',
			'📑',
			'🔖',
			'🏷️',
			'💰',
			'🪙',
			'💴',
			'💵',
			'💶',
			'💷',
			'💸',
			'💳',
			'🧾',
			'💹',
			'💱',
			'💲',
			'📧',
			'📨',
			'📩',
			'📤',
			'📥',
			'📦',
			'📫',
			'📪',
			'📬',
			'📭',
			'📮',
			'🗳️',
			'✏️',
			'✒️',
			'🖋️',
			'🖊️',
			'🖌️',
			'🖍️',
			'📝',
			'💼',
			'📁',
			'📂',
			'🗂️',
			'📅',
			'📆',
			'🗒️',
			'🗓️',
			'📇',
			'📈',
			'📉',
			'📊',
			'📋',
			'📌',
			'📍',
			'📎',
			'🖇️',
			'📏',
			'📐',
			'✂️',
			'🗃️',
			'🗄️',
			'🗑️',
			'🔒',
			'🔓',
			'🔏',
			'🔐',
			'🔑',
			'🗝️',
			'🔨',
			'🪓',
			'⛏️',
			'⚒️',
			'🛠️',
			'🗡️',
			'⚔️',
			'🔫',
			'🪃',
			'🏹',
			'🛡️',
			'🪚',
			'🔧',
			'🪛',
			'🔩',
			'⚙️',
			'🗜️',
			'⚖️',
			'🦯',
			'🔗',
			'⛓️',
			'🪝',
			'🧰',
			'🧲',
			'🪜',
			'⚗️',
			'🧪',
			'🧫',
			'🧬',
			'🔬',
			'🔭',
			'📡',
			'💉',
			'🩸',
			'💊',
			'🩹',
			'🩺',
			'🚪',
			'🛗',
			'🪞',
			'🪟',
			'🛏️',
			'🛋️',
			'🪑',
			'🚽',
			'🪠',
			'🚿',
			'🛁',
			'🪥',
			'🪒',
			'🧴',
			'🧷',
			'🧹',
			'🧺',
			'🧻',
			'🪣',
			'🧼',
			'🫧',
			'🪥',
			'🧽',
			'🧯',
			'🛒',
			'🚬',
			'⚰️',
			'🪦',
			'⚱️',
			'🗿',
			'🪧',
			'🪪',
		],
	},
	{
		id: 'symbols',
		label: 'Symbols',
		emoji: '❤️',
		items: [
			'❤️',
			'🧡',
			'💛',
			'💚',
			'💙',
			'💜',
			'🤎',
			'🖤',
			'🤍',
			'💔',
			'❣️',
			'💕',
			'💞',
			'💓',
			'💗',
			'💖',
			'💘',
			'💝',
			'💟',
			'☮️',
			'✝️',
			'☪️',
			'🕉️',
			'☸️',
			'✡️',
			'🔯',
			'🕎',
			'☯️',
			'☦️',
			'🛐',
			'⛎',
			'♈',
			'♉',
			'♊',
			'♋',
			'♌',
			'♍',
			'♎',
			'♏',
			'♐',
			'♑',
			'♒',
			'♓',
			'🆔',
			'⚛️',
			'🉑',
			'☢️',
			'☣️',
			'📴',
			'📳',
			'🈶',
			'🈚',
			'🈸',
			'🈺',
			'🈷️',
			'✴️',
			'🆚',
			'💮',
			'🉐',
			'㊙️',
			'㊗️',
			'🈴',
			'🈵',
			'🈹',
			'🈲',
			'🅰️',
			'🅱️',
			'🆎',
			'🆑',
			'🅾️',
			'🆘',
			'❌',
			'⭕',
			'🛑',
			'⛔',
			'📛',
			'🚫',
			'💯',
			'💢',
			'♨️',
			'🚷',
			'🚯',
			'🚳',
			'🚱',
			'🔞',
			'📵',
			'🚭',
			'❗',
			'❕',
			'❓',
			'❔',
			'‼️',
			'⁉️',
			'🔅',
			'🔆',
			'〽️',
			'⚠️',
			'🚸',
			'🔱',
			'⚜️',
			'🔰',
			'♻️',
			'✅',
			'🈯',
			'💹',
			'❇️',
			'✳️',
			'❎',
			'🌐',
			'💠',
			'Ⓜ️',
			'🌀',
			'💤',
			'🏧',
			'🚾',
			'♿',
			'🅿️',
			'🛗',
			'🈳',
			'🈂️',
			'🛂',
			'🛃',
			'🛄',
			'🛅',
			'🚹',
			'🚺',
			'🚼',
			'⚧',
			'🚻',
			'🚮',
			'🎦',
			'📶',
			'🈁',
			'🔣',
			'ℹ️',
			'🔤',
			'🔡',
			'🔠',
			'🆖',
			'🆗',
			'🆙',
			'🆒',
			'🆕',
			'🆓',
			'0️⃣',
			'1️⃣',
			'2️⃣',
			'3️⃣',
			'4️⃣',
			'5️⃣',
			'6️⃣',
			'7️⃣',
			'8️⃣',
			'9️⃣',
			'🔟',
			'🔢',
			'#️⃣',
			'*️⃣',
			'⏏️',
			'▶️',
			'⏸️',
			'⏯️',
			'⏹️',
			'⏺️',
			'⏭️',
			'⏮️',
			'⏩',
			'⏪',
			'⏫',
			'⏬',
			'◀️',
			'🔼',
			'🔽',
			'➡️',
			'⬅️',
			'⬆️',
			'⬇️',
			'↗️',
			'↘️',
			'↙️',
			'↖️',
			'↕️',
			'↔️',
			'↪️',
			'↩️',
			'⤴️',
			'⤵️',
			'🔀',
			'🔁',
			'🔂',
			'🔄',
			'🔃',
		],
	},
	{
		id: 'flags',
		label: 'Flags',
		emoji: '🏁',
		items: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️'],
	},
];

export interface EmojiPickerOpenOpts {
	/** The element the picker anchors against — typically the button
	 *  the user clicked. */
	anchor: HTMLElement;
	/** Called with the chosen emoji. Picker auto-closes after firing. */
	onPick: (emoji: string) => void;
}

let livePicker: EmojiPickerInstance | null = null;

/** Stable shape returned from `openEmojiPicker` so callers can
 *  programmatically close it if needed (rare; tests + edge cases). */
export interface EmojiPickerInstance {
	close(): void;
	el: HTMLElement;
}

/** Read the recent-emoji MRU. Empty array on first run / private mode. */
export function readRecentEmojis(): string[] {
	const raw = safeGet(RECENT_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX);
	} catch {
		return [];
	}
}

/** Bump an emoji to the top of the MRU. Strips skin-tone modifiers so
 *  variants don't clutter the list. */
export function recordRecentEmoji(emoji: string): void {
	const cleaned = emoji.replace(SKIN_TONE_RE, '');
	const cur = readRecentEmojis().filter((e) => e !== cleaned);
	cur.unshift(cleaned);
	safeSet(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)));
}

/** Open the shared emoji picker. Cancels any prior open so the page
 *  carries at most one picker at a time. */
export function openEmojiPicker(opts: EmojiPickerOpenOpts): EmojiPickerInstance {
	injectStyles();
	if (livePicker) livePicker.close();
	const root = document.createElement('div');
	root.className = 'mu-emoji-picker';
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-label', 'Emoji picker');
	root.innerHTML = `
		<div class="mu-emoji-picker__tabs" role="tablist"></div>
		<div class="mu-emoji-picker__grid" role="grid"></div>
	`;
	const tabsEl = root.querySelector<HTMLElement>('.mu-emoji-picker__tabs')!;
	const gridEl = root.querySelector<HTMLElement>('.mu-emoji-picker__grid')!;

	const recent = readRecentEmojis();
	const tabs: EmojiCategory[] = [
		{ id: 'recent', label: 'Recent', emoji: '🕘', items: recent },
		...CATEGORIES,
	];

	let activeIdx = recent.length > 0 ? 0 : 1; // Smileys default when Recent is empty

	const renderTabs = (): void => {
		tabsEl.innerHTML = tabs
			.map((t, i) => {
				const on = i === activeIdx ? ' mu-emoji-picker__tab--on' : '';
				const disabled = t.id === 'recent' && t.items.length === 0 ? ' disabled' : '';
				return `<button type="button" class="mu-emoji-picker__tab${on}" data-idx="${i}" title="${t.label}"${disabled}>${t.emoji}</button>`;
			})
			.join('');
	};
	const renderGrid = (): void => {
		const cat = tabs[activeIdx];
		if (!cat || cat.items.length === 0) {
			gridEl.innerHTML = `<div class="mu-emoji-picker__empty">No emoji yet — pick a few and they'll appear here.</div>`;
			return;
		}
		gridEl.innerHTML = cat.items
			.map(
				(e) =>
					`<button type="button" class="mu-emoji-picker__btn" data-emoji="${escapeAttr(e)}" aria-label="${escapeAttr(e)}">${e}</button>`,
			)
			.join('');
	};
	// Tabs use event delegation on the stable container so re-rendering
	// the tab strip on every switch doesn't strip the click listeners
	// (renderTabs rewrites the innerHTML; per-button listeners would
	// die with the old DOM and leave subsequent tabs unclickable).
	const onTabsClick = (e: MouseEvent): void => {
		const btn = (e.target as Element | null)?.closest<HTMLButtonElement>(
			'.mu-emoji-picker__tab',
		);
		if (!btn || btn.disabled) return;
		e.stopPropagation();
		const idx = Number(btn.dataset.idx);
		if (Number.isNaN(idx)) return;
		activeIdx = idx;
		renderTabs();
		renderGrid();
		wireGrid();
		// The new grid may be taller (Recent → Smileys etc.) or
		// shorter than the previous tab, so re-run the viewport-clamp
		// pass to make sure the picker still fits.
		reposition();
	};
	const wireGrid = (): void => {
		gridEl.querySelectorAll<HTMLButtonElement>('.mu-emoji-picker__btn').forEach((btn) => {
			btn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				const e = btn.dataset.emoji;
				if (!e) return;
				recordRecentEmoji(e);
				opts.onPick(e);
				close();
			});
		});
	};

	renderTabs();
	renderGrid();
	tabsEl.addEventListener('click', onTabsClick);
	wireGrid();

	document.body.appendChild(root);

	/**
	 * Position (or re-position) the picker against its anchor with a
	 * consistent margin from every viewport edge.
	 *
	 * Layout pass:
	 *   1. If the picker is taller than the viewport allows, clamp
	 *      its max-height so it fits (and we get a real measurement).
	 *   2. Horizontal: right-align the picker's right edge to the
	 *      anchor's right edge (so it opens DOWN-LEFT from the
	 *      click — the natural gesture for a button on the right
	 *      side). Fall back to left-aligned + viewport-clamp when
	 *      the right variant would clip the left edge.
	 *   3. Vertical: prefer below the anchor; flip above when the
	 *      down variant would clip the bottom; clamp to the viewport
	 *      either way so the picker is never off-screen.
	 *
	 * Called once on mount + whenever the picker's content height
	 * changes (tab switch grows / shrinks the grid).
	 */
	const reposition = (): void => {
		const margin = 8;
		const ar = opts.anchor.getBoundingClientRect();
		const availableH = window.innerHeight - 2 * margin;
		// Clear any cap from a prior pass so we measure the natural
		// height with the new content, then re-cap if needed.
		root.style.maxHeight = '';
		let pr = root.getBoundingClientRect();
		if (pr.height > availableH) {
			root.style.maxHeight = `${availableH}px`;
			pr = root.getBoundingClientRect();
		}

		let left = ar.right - pr.width;
		if (left < margin) left = ar.left;
		left = Math.max(margin, Math.min(window.innerWidth - pr.width - margin, left));

		let top = ar.bottom + 4;
		if (top + pr.height > window.innerHeight - margin) {
			top = ar.top - pr.height - 4;
		}
		top = Math.max(margin, Math.min(top, window.innerHeight - pr.height - margin));

		root.style.top = `${top}px`;
		root.style.left = `${left}px`;
	};
	reposition();

	const onDocClick = (e: MouseEvent): void => {
		if (root.contains(e.target as Node)) return;
		if (opts.anchor.contains(e.target as Node)) return;
		close();
	};
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') close();
	};
	// Defer attaching the dismiss listener so the click that opened
	// the picker doesn't immediately close it.
	setTimeout(() => {
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
	}, 0);

	function close(): void {
		document.removeEventListener('click', onDocClick);
		document.removeEventListener('keydown', onKey);
		root.remove();
		if (livePicker?.el === root) livePicker = null;
	}

	const instance: EmojiPickerInstance = { close, el: root };
	livePicker = instance;
	return instance;
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
