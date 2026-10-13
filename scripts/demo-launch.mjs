// Starts the API and the worker side by side. If either exits, take the other down and
// exit with its code, so the host restarts the container instead of running half a system.
import { spawn } from 'node:child_process';

const apps = ['api', 'worker'].map((name) =>
  spawn('node', ['--import', 'tsx', 'dist/main.js'], { cwd: `apps/${name}`, stdio: 'inherit' }),
);

for (const [i, child] of apps.entries()) {
  child.on('exit', (code, signal) => {
    console.error(`[demo-launch] ${i === 0 ? 'api' : 'worker'} exited (${signal ?? code})`);
    for (const other of apps) if (other !== child) other.kill('SIGTERM');
    process.exit(code ?? 1);
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => apps.forEach((c) => c.kill(sig)));
}
