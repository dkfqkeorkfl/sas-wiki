#!/usr/bin/env node
// codex-watch.mjs — Watch a Codex call's log and report when it goes quiet or ends.
//
// A Codex run (the sas-codex-chat script or the cc-suite runner) appends Codex's
// own output lines to a log file, mixed with runner lines that start with an ISO
// timestamp in brackets ("[2026-10-10T00:00:00.000Z] ..."). The runner lines
// include a heartbeat every 30s, so they say nothing about Codex itself. Every
// other line is Codex output and counts as activity.
//
// Whoever started the call runs this in the background next to it. The command
// only reports; whether to stop and resume the call is the caller's decision.
//
// Usage:
//   node codex-watch.mjs --log <file> --pid <pid> [--idle-ms <ms>] [--interval-ms <ms>]
//
// Prints one JSON line and exits:
//   {"verdict":"STALLED"|"ENDED","pid","threadId","outputLines","idleSeconds","elapsedSeconds"}
//     STALLED — no new Codex output line for --idle-ms while the pid is still alive.
//     ENDED   — the pid is gone (finished, failed or killed).
//   {"verdict":"ERROR","errorMessage"} with exit code 1 for bad arguments.

import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Besides the CLI below, this module exports the pieces codex-chat.mjs reuses:
// log reading, liveness, one-line event summaries and process-tree sampling.

const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30 * 1000;

// Runner lines: "[<ISO timestamp>] message". A Codex stderr line that merely
// starts with "[" (for example "[WARN] ...") is not matched and counts as output.
const RUNNER_LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]/;
const RUNNER_THREAD_LINE = /^\[[^\]]+\]\s*Thread:\s*(\S+)/;
const RAW_THREAD_ID = /"thread_id"\s*:\s*"([0-9a-fA-F-]{8,})"/;

function parseArgs(argv) {
  const args = {
    log: null,
    pid: null,
    idleMs: DEFAULT_IDLE_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    error: null,
  };

  const positive = (name, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      args.error = `${name} 값이 올바르지 않음: "${raw}". 0보다 큰 숫자(밀리초)여야 함.`;
      return null;
    }
    return n;
  };

  let i = 2;
  while (i < argv.length && !args.error) {
    const arg = argv[i];
    if (arg === '--log' && argv[i + 1]) {
      args.log = argv[++i];
    } else if (arg === '--pid' && argv[i + 1]) {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        args.error = `--pid 값이 올바르지 않음: "${raw}". 양의 정수여야 함.`;
      } else {
        args.pid = n;
      }
    } else if (arg === '--idle-ms' && argv[i + 1]) {
      args.idleMs = positive('--idle-ms', argv[++i]) ?? args.idleMs;
    } else if (arg === '--interval-ms' && argv[i + 1]) {
      args.intervalMs = positive('--interval-ms', argv[++i]) ?? args.intervalMs;
    } else {
      args.error = `알 수 없는 옵션 또는 값 누락: "${arg}"`;
    }
    i++;
  }

  if (!args.error && !args.log) args.error = '--log가 없음. 감시할 로그 파일 경로가 필요함.';
  if (!args.error && args.pid === null) args.error = '--pid가 없음. 감시할 프로세스 id가 필요함.';
  return args;
}

// Incremental reader: each call returns only the complete lines appended since
// the previous call. Bytes are buffered, not strings, so a multi-byte character
// split across two reads is never decoded half-way.
export function createLogReader(file) {
  let offset = 0;
  let partial = Buffer.alloc(0);

  return function readNewLines() {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return []; // the log may not exist yet right after the call starts
    }
    try {
      const { size } = fs.fstatSync(fd);
      if (size < offset) {
        offset = 0; // truncated or replaced: start over
        partial = Buffer.alloc(0);
      }
      if (size === offset) return [];

      const chunk = Buffer.alloc(size - offset);
      const read = fs.readSync(fd, chunk, 0, chunk.length, offset);
      offset += read;

      const data = Buffer.concat([partial, chunk.subarray(0, read)]);
      const lastNewline = data.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        partial = data;
        return [];
      }
      partial = data.subarray(lastNewline + 1);
      return data.subarray(0, lastNewline).toString('utf8').split('\n');
    } finally {
      fs.closeSync(fd);
    }
  };
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err.code === 'EPERM'; // exists, but owned by someone else
  }
  // An exited child that nobody has reaped yet still answers kill(pid, 0).
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return true; // no /proc (not Linux): trust kill(pid, 0)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_TEXT = 200;

function clip(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

// One Codex output line -> what Codex was doing: { kind, text }. Codex's JSON
// events become command / tool / search / message / reasoning / error; any
// other event is named by its type, and a line that is not JSON (for example
// stderr) is kept as it is. Blank lines give null.
export function summarizeEvent(line) {
  const raw = String(line ?? '').trim();
  if (!raw) return null;

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return { kind: 'output', text: clip(raw) };
  }
  if (!event || typeof event !== 'object') return { kind: 'output', text: clip(raw) };

  const item = event.item;
  if (item && typeof item === 'object') {
    switch (item.type) {
      case 'command_execution':
        return { kind: 'command', text: clip(item.command) };
      case 'mcp_tool_call':
        return { kind: 'tool', text: clip(`${item.server}.${item.tool}`) };
      case 'web_search':
        return {
          kind: 'search',
          text: clip(item.query || item.action?.url || item.action?.query || item.action?.type),
        };
      case 'agent_message':
        return { kind: 'message', text: clip(item.text) };
      case 'reasoning':
        return { kind: 'reasoning', text: clip(item.text) };
      case 'error':
        return { kind: 'error', text: clip(item.message) };
      default:
        return { kind: 'other', text: clip(item.type) };
    }
  }
  return { kind: 'event', text: clip(event.type ?? raw) };
}

// `ps` prints CPU time as [[DD-]hh:]mm:ss.
function parseCpuTime(value) {
  const found = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  if (!found) return 0;
  const [, days = 0, hours = 0, minutes, seconds] = found;
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

// Resident memory (KB), cumulative CPU seconds and process count of `rootPid`
// and everything it started. Null when the pid is gone or `ps` is unavailable.
export function readProcessTree(rootPid) {
  const listing = spawnSync('ps', ['-eo', 'pid=,ppid=,rss=,time='], { encoding: 'utf8' });
  if (listing.status !== 0 || !listing.stdout) return null;

  const rows = new Map();
  for (const row of listing.stdout.split('\n')) {
    const fields = row.trim().split(/\s+/);
    if (fields.length < 4) continue;
    rows.set(Number(fields[0]), {
      ppid: Number(fields[1]),
      rssKb: Number(fields[2]),
      cpuSeconds: parseCpuTime(fields[3]),
    });
  }
  if (!rows.has(rootPid)) return null;

  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, row] of rows) {
      if (!tree.has(pid) && tree.has(row.ppid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }

  let rssKb = 0;
  let cpuSeconds = 0;
  for (const pid of tree) {
    rssKb += rows.get(pid).rssKb;
    cpuSeconds += rows.get(pid).cpuSeconds;
  }
  return { processes: tree.size, rssKb, cpuSeconds };
}

// Each call returns { cpuPercent, rssMB, processes } for the tree under
// `rootPid`. cpuPercent is the CPU used since the previous call (null on the
// first call). Returns null once the pid is gone.
export function createResourceSampler(rootPid) {
  let previous = null;
  return function sample() {
    const tree = readProcessTree(rootPid);
    if (!tree) return null;

    const at = Date.now();
    let cpuPercent = null;
    if (previous) {
      const seconds = (at - previous.at) / 1000;
      if (seconds > 0) {
        const used = (tree.cpuSeconds - previous.cpuSeconds) / seconds;
        cpuPercent = Math.max(0, Math.round(used * 1000) / 10);
      }
    }
    previous = { at, cpuSeconds: tree.cpuSeconds };
    return { cpuPercent, rssMB: Math.round(tree.rssKb / 1024), processes: tree.processes };
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    console.log(JSON.stringify({ verdict: 'ERROR', errorMessage: args.error }));
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const readNewLines = createLogReader(args.log);
  let outputLines = 0;
  let threadId = null;
  let lastActivityAt = startedAt;

  const report = (verdict) => {
    const now = Date.now();
    console.log(
      JSON.stringify({
        verdict,
        pid: args.pid,
        threadId,
        outputLines,
        idleSeconds: Math.round((now - lastActivityAt) / 1000),
        elapsedSeconds: Math.round((now - startedAt) / 1000),
      }),
    );
  };

  while (true) {
    for (const line of readNewLines()) {
      if (!line.trim()) continue;
      if (RUNNER_LINE.test(line)) {
        const found = line.match(RUNNER_THREAD_LINE);
        if (found && !threadId) threadId = found[1];
        continue;
      }
      outputLines++;
      lastActivityAt = Date.now();
      if (!threadId) {
        const found = line.match(RAW_THREAD_ID);
        if (found) threadId = found[1];
      }
    }

    if (!pidAlive(args.pid)) {
      report('ENDED');
      return;
    }
    if (Date.now() - lastActivityAt >= args.idleMs) {
      report('STALLED');
      return;
    }
    await sleep(args.intervalMs);
  }
}

// Run the CLI only when this file is the entry point, not when it is imported.
const entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : null;
if (entry === fs.realpathSync(fileURLToPath(import.meta.url))) main();
