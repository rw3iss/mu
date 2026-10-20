/**
 * Input options for every ffmpeg / ffprobe call on a media file.
 *
 * `-protocol_whitelist file,pipe` stops a crafted media file (HLS/concat
 * playlists hidden in .avi/.mkv, `subfile:`/`http:` references, …) from
 * making ffmpeg fetch URLs or open other files outside the one it was given —
 * the classic ffmpeg SSRF / local-file-read trick. Nested opens (e.g. the
 * concat demuxer's entries) inherit the whitelist. Local files and pipes are
 * all Mu ever feeds ffmpeg.
 */
export const SAFE_INPUT_OPTIONS: readonly string[] = ['-protocol_whitelist', 'file,pipe'];
