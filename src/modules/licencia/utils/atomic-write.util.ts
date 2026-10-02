import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Atomically writes `data` to `target` with restrictive permissions: writes a
 * temporary sibling file (exclusive create, mode 0600), fsyncs it, then renames
 * it over the target. Errors are NOT swallowed; the temporary file is removed
 * on failure.
 */
export async function writeFileAtomic(
  target: string,
  data: string,
  mode = 0o600,
): Promise<void> {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(tmp, 'wx', mode);
    await handle.writeFile(data, 'utf8');
    // The umask may have widened/narrowed the creation mode; enforce it.
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(tmp, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw error;
  }
}
