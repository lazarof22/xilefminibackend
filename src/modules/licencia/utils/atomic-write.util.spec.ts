import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomic } from './atomic-write.util';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the content with mode 0600', async () => {
    const target = path.join(dir, 'license.lic');
    await writeFileAtomic(target, '{"a":1}');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"a":1}');
    if (process.platform !== 'win32') {
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    }
  });

  it('replaces an existing file and tightens its permissions', async () => {
    const target = path.join(dir, 'license.lic');
    fs.writeFileSync(target, 'old', { mode: 0o644 });
    await writeFileAtomic(target, 'new');
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    if (process.platform !== 'win32') {
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    }
  });

  it('leaves no temporary files behind', async () => {
    const target = path.join(dir, 'license.lic');
    await writeFileAtomic(target, 'x');
    expect(fs.readdirSync(dir)).toEqual(['license.lic']);
  });

  it('rejects (does not swallow) write errors', async () => {
    const target = path.join(dir, 'missing-dir', 'license.lic');
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
  });
});
