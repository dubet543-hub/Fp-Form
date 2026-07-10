#!/usr/bin/env node
// Free the given port(s) before starting, so a leftover process never blocks a
// new run with EADDRINUSE. Runs automatically via npm's prestart / predev.
//
// Usage:
//   node free-ports.js            // frees both app ports (3001 and 5173)
//   node free-ports.js 3001       // frees only 3001

const { execSync } = require('child_process');

const ports = process.argv.slice(2).length ? process.argv.slice(2) : ['3001', '5173'];
const isWindows = process.platform === 'win32';

for (const port of ports) {
  try {
    if (isWindows) {
      const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const match = line.trim().match(/LISTENING\s+(\d+)\s*$/);
        if (match) pids.add(match[1]);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`freed port ${port}`);
        } catch {}
      }
    } else {
      const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
      if (pids) {
        execSync(`kill -9 ${pids.split('\n').join(' ')}`, { stdio: 'ignore' });
        console.log(`freed port ${port}`);
      }
    }
  } catch {
    // no process on this port, or command unavailable — nothing to free
  }
}
