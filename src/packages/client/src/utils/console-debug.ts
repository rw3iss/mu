import { APP_VERSION } from '@mu/shared';
import { getActiveVideoElement } from '@/components/player/useVideoEngine';
/**
 * Client-side console debug utility.
 * Exposes `window.mu` for live app control from the browser console.
 *
 * Usage: open console, type `mu` for help.
 */
import {
	closePlayer,
	globalMovie,
	globalMovieId,
	maximizePlayer,
	minimizePlayer,
	playerMode,
	splitPlayer,
	splitWidth,
} from '@/state/globalPlayer.state';
import { currentSession, currentTime, duration, isPlaying, volume } from '@/state/player.state';
import { pipDiagnostics, togglePictureInPicture } from '@/utils/pip';

const PREFIX = 'mu_ui_';

function getAllConfig(): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key || !key.startsWith('mu_')) continue;
		try {
			result[key] = JSON.parse(localStorage.getItem(key)!);
		} catch {
			result[key] = localStorage.getItem(key);
		}
	}
	return result;
}

function getConfig(key: string): unknown {
	// Try with and without prefix
	const raw = localStorage.getItem(key) ?? localStorage.getItem(PREFIX + key);
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function setConfig(key: string, value: string): void {
	// Auto-add prefix if it looks like a UI setting
	const fullKey = key.startsWith('mu_') ? key : PREFIX + key;
	// Try to store as JSON if it looks like a number/boolean
	if (value === 'true' || value === 'false') {
		localStorage.setItem(fullKey, JSON.stringify(value === 'true'));
	} else if (!Number.isNaN(Number(value)) && value.trim() !== '') {
		localStorage.setItem(fullKey, JSON.stringify(Number(value)));
	} else {
		localStorage.setItem(fullKey, JSON.stringify(value));
	}
	console.log(
		`%c${fullKey}%c = %c${value}`,
		'color: #82aaff',
		'color: inherit',
		'color: #c3e88d',
	);
}

function deleteConfig(key: string): void {
	const fullKey = key.startsWith('mu_') ? key : PREFIX + key;
	localStorage.removeItem(fullKey);
	console.log(`Deleted: ${fullKey}`);
}

const HELP = `
%c╔══════════════════════════════════════╗
║          Mu Console Utility          ║
╚══════════════════════════════════════╝%c

%cConfig:%c
  mu.config()              List all mu_ settings
  mu.config('key')         Get a setting value
  mu.config.set('key', v)  Set a setting (auto-prefixes mu_ui_)
  mu.config.del('key')     Delete a setting

%cPlayer:%c
  mu.player()              Current player state
  mu.player.play()         Resume playback
  mu.player.pause()        Pause playback
  mu.player.mode('full')   Set mode: full | mini | split | hidden
  mu.player.volume(0.8)    Set volume (0-1)
  mu.player.seek(120)      Seek to time in seconds
  mu.player.split(50)      Set split width (25-62 percent)

%cDebug:%c
  mu.pip()                 Picture-in-Picture support diagnostics\n  mu.pip.try()             Force a PiP attempt + report why it failed\n  mu.hls(true)             Enable HLS.js debug logging
  mu.hls(false)            Disable HLS.js debug logging
  mu.version               App version

%cExamples:%c
  mu.config.set('font_scale', 3)
  mu.config.set('theme', 'dark')
  mu.player.mode('split')
  mu.player.split(40)
`;

function printHelp() {
	console.log(
		HELP,
		'color: #82aaff; font-weight: bold',
		'',
		'color: #ffcb6b; font-weight: bold',
		'',
		'color: #ffcb6b; font-weight: bold',
		'',
		'color: #ffcb6b; font-weight: bold',
		'',
		'color: #ffcb6b; font-weight: bold',
		'',
	);
}

function playerState() {
	const state = {
		mode: playerMode.value,
		movieId: globalMovieId.value,
		movieTitle: globalMovie.value?.title ?? null,
		sessionId: currentSession.value?.sessionId ?? null,
		isPlaying: isPlaying.value,
		currentTime: Math.round(currentTime.value),
		duration: Math.round(duration.value),
		volume: volume.value,
		splitWidth: splitWidth.value,
	};
	console.table(state);
	return state;
}

const mu = {
	get help() {
		printHelp();
		return '';
	},

	version: APP_VERSION,

	config: Object.assign(
		(key?: string) => {
			if (key) {
				const val = getConfig(key);
				console.log(`${key} =`, val);
				return val;
			}
			const all = getAllConfig();
			console.table(all);
			return all;
		},
		{
			set: setConfig,
			del: deleteConfig,
		},
	),

	player: Object.assign(() => playerState(), {
		play: () => {
			const video = document.querySelector('video');
			video?.play().catch(() => {});
			console.log('Playing');
		},
		pause: () => {
			const video = document.querySelector('video');
			video?.pause();
			console.log('Paused');
		},
		mode: (m: string) => {
			switch (m) {
				case 'full':
					maximizePlayer();
					break;
				case 'mini':
					minimizePlayer();
					break;
				case 'split':
					splitPlayer();
					break;
				case 'hidden':
					closePlayer();
					break;
				default:
					console.log('Valid modes: full, mini, split, hidden');
					return;
			}
			console.log(`Mode: ${m}`);
		},
		volume: (v: number) => {
			volume.value = Math.max(0, Math.min(1, v));
			console.log(`Volume: ${volume.value}`);
		},
		seek: (seconds: number) => {
			const video = document.querySelector('video');
			if (video) {
				video.currentTime = seconds;
				console.log(`Seeked to ${seconds}s`);
			}
		},
		split: (percent: number) => {
			const w = Math.max(25, Math.min(62, Math.round(percent)));
			splitWidth.value = w;
			localStorage.setItem('mu_ui_split_width', String(w));
			if (playerMode.value !== 'split') splitPlayer();
			console.log(`Split width: ${w}%`);
		},
	}),

	/**
	 * Picture-in-Picture diagnostics — the fastest way to see WHY PiP isn't
	 * available on a given device (especially Chrome for Android, which has no
	 * Web PiP API). `mu.pip.try()` forces an attempt and reports the failure.
	 */
	pip: Object.assign(
		() => {
			const d = pipDiagnostics(getActiveVideoElement());
			console.table(d);
			if (d.reasonIfUnsupported) console.warn(d.reasonIfUnsupported);
			return d;
		},
		{
			try: async () => {
				const ok = await togglePictureInPicture(getActiveVideoElement());
				const d = pipDiagnostics(getActiveVideoElement());
				console.log(ok ? 'PiP entered.' : 'PiP failed.', d.lastError ?? '');
				return d;
			},
		},
	),

	hls: (enable: boolean) => {
		if (enable) {
			localStorage.setItem('mu_hls_debug', '1');
			console.log('HLS debug enabled (reload player to apply)');
		} else {
			localStorage.removeItem('mu_hls_debug');
			console.log('HLS debug disabled (reload player to apply)');
		}
	},
};

// Make `mu` in console print help automatically
const proxy = new Proxy(mu, {
	get(target, prop) {
		if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
			return () => {
				printHelp();
				return 'mu';
			};
		}
		return Reflect.get(target, prop);
	},
});

export function initConsoleDebug() {
	(window as any).mu = proxy;
}
