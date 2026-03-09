import { signal } from '@preact/signals';
import type { VideoEngine } from '@/components/player/useVideoEngine';

export const sharedVideoEngine = signal<VideoEngine | null>(null);

export function setSharedVideoEngine(e: VideoEngine | null) {
  sharedVideoEngine.value = e;
}
