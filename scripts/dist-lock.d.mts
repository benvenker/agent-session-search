export declare const DEFAULT_DIST_LOCK_TIMEOUT_MS: number;

export declare function defaultDistLockDir(cwd: string): Promise<string>;

export declare function parseDistLockTimeoutMs(raw: string | undefined): number;

export declare function acquireDistLock(options: {
  cwd: string;
  lockDir: string;
  timeoutMs: number;
}): Promise<() => Promise<void>>;
