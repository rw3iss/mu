import type { VideoEngine } from '@/components/player/useVideoEngine';

export let sharedVideoEngine: VideoEngine | null = null;

export function setSharedVideoEngine(e: VideoEngine | null) {
  sharedVideoEngine = e;
}
