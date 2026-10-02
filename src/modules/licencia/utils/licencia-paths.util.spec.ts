import * as path from 'path';
import {
  resolveLicenseFilePath,
  resolveStatePath,
} from './licencia-paths.util';

describe('licencia paths', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('defaults to license.lic and license.state in the cwd', () => {
    delete process.env.LICENSE_FILE_PATH;
    delete process.env.LICENSE_STATE_PATH;
    expect(resolveLicenseFilePath()).toBe(
      path.resolve(process.cwd(), 'license.lic'),
    );
    expect(resolveStatePath()).toBe(
      path.resolve(process.cwd(), 'license.state'),
    );
  });

  it('places the state file next to a custom license file', () => {
    process.env.LICENSE_FILE_PATH = '/srv/xilef/license.lic';
    delete process.env.LICENSE_STATE_PATH;
    expect(resolveStatePath()).toBe(path.resolve('/srv/xilef/license.state'));
  });

  it('honours an explicit state path', () => {
    process.env.LICENSE_STATE_PATH = '/var/lib/xilef/clock.state';
    expect(resolveStatePath()).toBe(path.resolve('/var/lib/xilef/clock.state'));
  });
});
