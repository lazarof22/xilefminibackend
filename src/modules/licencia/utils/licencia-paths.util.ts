import * as path from 'path';

/** Exported signed artifact (`.lic`). Env: LICENSE_FILE_PATH. */
export function resolveLicenseFilePath(): string {
  return path.resolve(
    process.env.LICENSE_FILE_PATH || path.join(process.cwd(), 'license.lic'),
  );
}

/**
 * HMAC-protected monotonic clock state. Env: LICENSE_STATE_PATH; defaults to
 * `license.state` next to the license file. Must be writable.
 */
export function resolveStatePath(): string {
  if (process.env.LICENSE_STATE_PATH) {
    return path.resolve(process.env.LICENSE_STATE_PATH);
  }
  return path.join(path.dirname(resolveLicenseFilePath()), 'license.state');
}
