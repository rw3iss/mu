/**
 * Exit code for the next shutdown. The admin restart endpoint sets a non-zero
 * code under systemd so `Restart=on-failure` brings the server back up; a clean
 * exit 0 would leave the unit stopped.
 */
export const RESTART_EXIT_CODE = 75;

let exitCode = 0;

export function setShutdownExitCode(code: number): void {
	exitCode = code;
}

export function shutdownExitCode(): number {
	return exitCode;
}
