import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/build-addon-decls.mjs', 'physlib'], {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
