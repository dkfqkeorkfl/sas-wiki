#!/usr/bin/env node
// codex-chat.mjs — Run a free-form Codex turn (fresh or resumed) via `codex exec`
// and watch it in short rounds. Not the MCP bridge: that has no controllable
// timeout and hangs on long single responses. A fresh `codex exec` subprocess
// per call has no shared state to go stale, so concurrent calls do not block
// each other.
//
// Two kinds of process take part (the skill docs call them 러너 and 감시자):
//   worker   Runs `codex exec` detached, so it outlives the command that started
//            it. It owns the run log, a state file next to it (<log>.state.json),
//            the safety-net deadline (2 hours) and a "Check:" line in the log
//            every tick.
//   watcher  The command the caller starts. It starts the worker (or finds it
//            with --attach), watches for at most one tick (--tick-ms, 15 minutes)
//            and prints one JSON line. The caller wakes up when it exits; the
//            worker keeps running. --stop ends the worker.
//
// The deadline is a safety net, not a work limit. This script never retries and
// never falls back; it reports what happened and the caller decides what next.
//
// Usage:
//   node codex-chat.mjs --model <nickname-or-slug> [--effort <level>] \
//     [--timeout-ms <ms>] [--tick-ms <ms>] [--resume <threadId>] \
//     [--log-file <path>] -- <prompt>
//   node codex-chat.mjs --attach <log-file> [--tick-ms <ms>]
//   node codex-chat.mjs --stop <log-file>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createResourceSampler, pidAlive, summarizeEvent } from '../../../scripts/codex-watch.mjs';

const SELF = fileURLToPath(import.meta.url);

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_TICK_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_EFFORT = 'high';
const SIGKILL_GRACE_MS = 5 * 1000;
const STOP_WAIT_MS = SIGKILL_GRACE_MS + 5 * 1000;
const STATE_WRITE_MS = 100;

const NICKNAME_SUFFIX = new Map([
  ['sol', '-sol'],
  ['솔', '-sol'],
  ['luna', '-luna'],
  ['루나', '-luna'],
]);

function parseArgs(argv) {
  const args = {
    model: null,
    effort: DEFAULT_EFFORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    tickMs: DEFAULT_TICK_MS,
    resume: null,
    logFile: null,
    attach: null,
    stop: null,
    worker: false,
    prompt: null,
    error: null,
  };

  const positive = (flag, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      args.error = `${flag} 값이 올바르지 않음: "${raw}". 0보다 큰 숫자(밀리초)여야 함.`;
      return null;
    }
    return n;
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--worker') {
      args.worker = true;
    } else if (arg === '--model' && argv[i + 1]) {
      args.model = argv[++i];
    } else if (arg === '--effort' && argv[i + 1]) {
      args.effort = argv[++i];
    } else if (arg === '--timeout-ms' && argv[i + 1]) {
      const n = positive(arg, argv[++i]);
      if (n === null) break;
      args.timeoutMs = n;
    } else if (arg === '--tick-ms' && argv[i + 1]) {
      const n = positive(arg, argv[++i]);
      if (n === null) break;
      args.tickMs = n;
    } else if (arg === '--resume' && argv[i + 1]) {
      args.resume = argv[++i];
    } else if (arg === '--log-file' && argv[i + 1]) {
      args.logFile = argv[++i];
    } else if (arg === '--attach' && argv[i + 1]) {
      args.attach = argv[++i];
    } else if (arg === '--stop' && argv[i + 1]) {
      args.stop = argv[++i];
    } else if (arg === '--') {
      args.prompt = argv.slice(i + 1).join(' ');
      break;
    } else if (arg.startsWith('--')) {
      args.error = `알 수 없는 옵션: "${arg}"`;
      break;
    }
    i++;
  }

  if (!args.error && args.attach && args.stop) {
    args.error = '--attach와 --stop은 함께 쓸 수 없음.';
  }
  return args;
}

// Model nicknames (sol/luna, or their Korean names) resolve against
// `~/.codex/models_cache.json` — the file the `codex` CLI itself maintains on
// login/refresh. Reading it directly avoids depending on any plugin's own
// script path for something this simple. A value that isn't a known nickname
// is passed through as a literal slug.
function resolveModel(rawValue) {
  const trimmed = rawValue.trim();
  const suffix = NICKNAME_SUFFIX.get(trimmed) ?? NICKNAME_SUFFIX.get(trimmed.toLowerCase());
  if (!suffix) {
    return trimmed;
  }

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const cachePath = path.join(codexHome, 'models_cache.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `모델 캐시(${cachePath})를 읽을 수 없음: ${err.message}. 'codex login'으로 갱신 필요.`,
    );
  }

  const models = Array.isArray(data.models) ? data.models : [];
  const match = models.find((m) => typeof m?.slug === 'string' && m.slug.endsWith(suffix));
  if (!match) {
    const available = models.map((m) => m.slug).join(', ') || '(없음)';
    throw new Error(`"${suffix}"로 끝나는 모델이 없음. 사용 가능: ${available}`);
  }
  return match.slug;
}

function buildCodexArgs(args, model, outFile) {
  const codexArgs = ['exec'];
  if (args.resume) {
    codexArgs.push('resume', args.resume);
  }
  if (model) {
    codexArgs.push('--model', model);
  }
  if (!args.resume) {
    codexArgs.push('--sandbox', 'read-only');
  }
  codexArgs.push('--skip-git-repo-check', '--json');
  // `codex exec resume` has no -s/--sandbox flag. Confirmed empirically that
  // an unrestricted resume falls back to the global config's sandbox_mode
  // (workspace-write here) instead of the original session's read-only
  // setting, so a plain resume can actually write files. Force read-only via
  // the generic -c override on every call, fresh or resumed.
  codexArgs.push('-c', `sandbox_mode="read-only"`);
  if (args.effort) {
    codexArgs.push('-c', `model_reasoning_effort=${args.effort}`);
  }
  codexArgs.push('-o', outFile);
  codexArgs.push(args.prompt);
  return codexArgs;
}

function extractThreadId(line) {
  try {
    const evt = JSON.parse(line);
    if (evt && typeof evt.thread_id === 'string') return evt.thread_id;
  } catch {
    // fall through to the tolerant regex scan below
  }
  const m = line.match(/"thread_id"\s*:\s*"([0-9a-fA-F-]{16,})"/);
  return m ? m[1] : null;
}

function readLastMessage(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run log, in the same shape as the cc-suite runner's job log so that
// codex-watch.mjs can read both: runner events are "[<ISO timestamp>] message"
// lines, and everything else is Codex's own output, appended as it arrives.
function createRunLog(file) {
  let atLineStart = true;
  return {
    note(message) {
      const prefix = atLineStart ? '' : '\n';
      fs.appendFileSync(file, `${prefix}[${new Date().toISOString()}] ${message}\n`);
      atLineStart = true;
    },
    raw(text) {
      if (!text) return;
      fs.appendFileSync(file, text);
      atLineStart = text.endsWith('\n');
    },
  };
}

// ------------------------------------------------------------ state file ----
// The worker is the only writer; watchers only read. The result is stored here
// too, so a watcher that starts after the worker finished still gets it.

const stateFileOf = (logFile) => `${logFile}.state.json`;

function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function lastActivityOf(state) {
  if (!state?.lastActivity) return null;
  const secondsAgo = Math.max(0, Math.round((Date.now() - state.lastOutputAtMs) / 1000));
  return { ...state.lastActivity, secondsAgo };
}

function formatCheck(state, resources) {
  const activity = lastActivityOf(state);
  const last = activity
    ? `last activity ${activity.secondsAgo}s ago (${activity.kind}: ${activity.text})`
    : 'no output yet';
  const used = resources
    ? `cpu ${resources.cpuPercent ?? 0}%, rss ${resources.rssMB}MB, ${resources.processes} processes`
    : 'resources unavailable';
  return `Check: ${state.outputLines} output lines, ${last}, ${used}`;
}

// ---------------------------------------------------------------- worker ----

function lineSplitter(onLine) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        onLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    },
    end() {
      if (buffer.trim()) onLine(buffer);
      buffer = '';
    },
  };
}

function runWorker(args) {
  const startedAtMs = Date.now();
  const log = createRunLog(args.logFile);
  const statePath = stateFileOf(args.logFile);
  const outFile = path.join(os.tmpdir(), `codex-chat-${process.pid}-${startedAtMs}.txt`);
  const state = {
    pid: process.pid,
    startedAtMs,
    codexPid: null,
    threadId: null,
    outputLines: 0,
    lastOutputAtMs: null,
    lastActivity: null,
    result: null,
  };

  let writeTimer = null;
  const flush = () => {
    clearTimeout(writeTimer);
    writeTimer = null;
    writeState(statePath, state);
  };
  const touch = () => {
    if (!writeTimer) writeTimer = setTimeout(flush, STATE_WRITE_MS);
  };

  log.note(`Started pid=${process.pid}`);
  log.note(
    `Model: ${args.model ?? '(resumed session)'}, Effort: ${args.effort}, Resume: ${args.resume ?? 'none'}`,
  );
  log.note(`Deadline: ${Math.round(args.timeoutMs / 1000)}s`);
  flush();

  let settled = false;
  let timedOut = false;
  let terminatedBy = null;
  let stderrTail = '';

  // stdio[0] = "ignore": `codex exec` can hang on stdin when there is no
  // controlling TTY (background/hook contexts), so fd 0 is /dev/null.
  const child = spawn('codex', buildCodexArgs(args, args.model, outFile), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  state.codexPid = child.pid ?? null;

  const sample = createResourceSampler(process.pid);
  sample();
  const checkTimer = setInterval(() => log.note(formatCheck(state, sample())), args.tickMs);
  checkTimer.unref();

  function killChild() {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!settled) child.kill('SIGKILL');
    }, SIGKILL_GRACE_MS).unref();
  }

  const deadline = setTimeout(() => {
    timedOut = true;
    log.note(`Deadline exceeded (${Math.round(args.timeoutMs / 1000)}s) — terminating`);
    killChild();
  }, args.timeoutMs);

  // `kill <pid>` (or --stop) takes the codex child down with the worker
  // instead of leaving it behind as an orphan.
  function onSignal(signal) {
    if (terminatedBy) return;
    terminatedBy = signal;
    log.note(`Terminated by signal ${signal}`);
    killChild();
  }
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  function finish(result) {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    clearInterval(checkTimer);
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
    state.result = result;
    flush();
    setImmediate(() => process.exit(result.status === 'completed' ? 0 : 1));
  }

  function onLine(line) {
    if (!line.trim()) return;
    state.outputLines += 1;
    state.lastOutputAtMs = Date.now();
    state.lastActivity = summarizeEvent(line);
    if (!state.threadId) {
      const found = extractThreadId(line);
      if (found) {
        state.threadId = found;
        log.note(`Thread: ${found}`);
        flush(); // the thread id is what makes a call resumable, so record it at once
      }
    }
    touch();
  }

  const stdoutLines = lineSplitter(onLine);
  const stderrLines = lineSplitter(onLine);

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    log.raw(text);
    stdoutLines.push(text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    log.raw(text);
    stderrLines.push(text);
    stderrTail = (stderrTail + text).slice(-2000);
  });

  const elapsed = () => Math.round((Date.now() - startedAtMs) / 1000);
  const failedResult = (errorMessage, rawOutput = '') => ({
    status: 'failed',
    errorMessage,
    threadId: state.threadId,
    elapsedSeconds: elapsed(),
    rawOutput,
    lastActivity: lastActivityOf(state),
  });

  child.on('error', (err) => {
    log.note(`Spawn error: ${err.message}`);
    finish(failedResult(`codex 실행 실패: ${err.message}`));
  });

  child.on('close', (code, signal) => {
    stdoutLines.end();
    stderrLines.end();
    const rawOutput = readLastMessage(outFile);

    if (terminatedBy) {
      finish(
        failedResult(
          `${terminatedBy} 신호를 받아 종료함. thread_id가 있으면 --resume으로 이어갈 수 있음.`,
          rawOutput,
        ),
      );
      return;
    }

    if (timedOut) {
      finish({
        status: 'timed_out',
        errorMessage: `${Math.round(args.timeoutMs / 1000)}초 안에 끝나지 않아 강제 종료함. thread_id가 있으면 --resume으로 이어갈 수 있음.`,
        threadId: state.threadId,
        elapsedSeconds: elapsed(),
        rawOutput,
        lastActivity: lastActivityOf(state),
      });
      return;
    }

    if (code !== 0) {
      const stderrMsg = stderrTail.trim();
      const errorMessage =
        code === null
          ? `signal ${signal}${stderrMsg ? `: ${stderrMsg}` : ''}`
          : stderrMsg || `exit ${code}`;
      log.note(`Failed: ${errorMessage}`);
      finish(failedResult(errorMessage, rawOutput));
      return;
    }

    log.note('Completed successfully');
    finish({
      status: 'completed',
      threadId: state.threadId,
      elapsedSeconds: elapsed(),
      rawOutput,
    });
  });
}

// --------------------------------------------------------------- watcher ----

function emit(payload, exitCode) {
  console.log(JSON.stringify(payload));
  process.exitCode = exitCode;
}

const fail = (message) => emit({ status: 'failed', errorMessage: message }, 1);

const emitResult = (result, logFile) =>
  emit({ ...result, logFile }, result.status === 'completed' ? 0 : 1);

const elapsedOf = (state, fallbackStartMs) =>
  Math.round((Date.now() - (state?.startedAtMs ?? fallbackStartMs)) / 1000);

// Watches the worker for at most one tick, then prints one line: the result if
// the worker finished, otherwise "running" (new Codex output arrived since this
// watcher began) or "stalled" (none did), with hints to tell the two apart.
async function watch({ logFile, workerPid, tickMs, baseLines }) {
  const statePath = stateFileOf(logFile);
  const startedAt = Date.now();
  const sample = createResourceSampler(workerPid);
  sample();
  // Reading a small file is cheap, so look often enough to notice an end within a second.
  const pollMs = Math.min(1000, Math.max(20, Math.floor(tickMs / 10)));

  for (;;) {
    const state = readState(statePath);
    if (state?.result) return emitResult(state.result, logFile);

    if (!pidAlive(workerPid)) {
      // The result may have been written between the read above and the exit.
      const last = readState(statePath);
      if (last?.result) return emitResult(last.result, logFile);
      return emit(
        {
          status: 'failed',
          errorMessage:
            '러너가 결과 없이 끝남(강제 종료 등). 로그를 확인하고, thread_id가 있으면 --resume으로 이어갈 수 있음.',
          threadId: last?.threadId ?? null,
          elapsedSeconds: elapsedOf(last, startedAt),
          lastActivity: lastActivityOf(last),
          logFile,
        },
        1,
      );
    }

    if (Date.now() - startedAt >= tickMs) {
      const lines = state?.outputLines ?? 0;
      const resources = sample();
      return emit(
        {
          status: lines > baseLines ? 'running' : 'stalled',
          logFile,
          pid: workerPid,
          threadId: state?.threadId ?? null,
          elapsedSeconds: elapsedOf(state, startedAt),
          hint: {
            outputLines: lines,
            newOutputLines: lines - baseLines,
            lastActivity: lastActivityOf(state),
            cpuPercent: resources?.cpuPercent ?? null,
            rssMB: resources?.rssMB ?? null,
            processes: resources?.processes ?? null,
          },
        },
        0,
      );
    }
    await sleep(pollMs);
  }
}

async function startCall(args) {
  if (!args.prompt) {
    return fail("prompt가 없음. '-- <prompt>' 형식으로 넘겨야 함.");
  }
  if (!args.resume && !args.model) {
    return fail(
      'model이 없음. 신규 호출(--resume 없음)은 model이 필수임(sol/솔, luna/루나, 또는 실제 슬러그).',
    );
  }

  let model = null;
  try {
    if (args.model) model = resolveModel(args.model);
  } catch (err) {
    return fail(err.message);
  }

  const logFile = path.resolve(
    args.logFile ?? path.join(os.tmpdir(), `codex-chat-${Date.now()}-${process.pid}.log`),
  );
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, ''); // a fresh log per call
    fs.rmSync(stateFileOf(logFile), { force: true });
  } catch (err) {
    return fail(`--log-file을 쓸 수 없음 ("${args.logFile ?? logFile}"): ${err.message}`);
  }

  const workerArgs = [
    SELF,
    '--worker',
    '--effort',
    args.effort,
    '--timeout-ms',
    String(args.timeoutMs),
    '--tick-ms',
    String(args.tickMs),
    '--log-file',
    logFile,
  ];
  if (model) workerArgs.push('--model', model);
  if (args.resume) workerArgs.push('--resume', args.resume);
  workerArgs.push('--', args.prompt);

  const worker = spawn(process.execPath, workerArgs, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  worker.on('error', () => {});
  worker.unref();
  if (!worker.pid) {
    return fail('러너를 시작하지 못함.');
  }

  return watch({ logFile, workerPid: worker.pid, tickMs: args.tickMs, baseLines: 0 });
}

function attachCall(args) {
  const logFile = path.resolve(args.attach);
  const state = readState(stateFileOf(logFile));
  if (!state) {
    return fail(
      `상태 파일이 없음: "${stateFileOf(logFile)}". --attach에는 이 스크립트가 시작한 호출의 로그 경로를 넘겨야 함.`,
    );
  }
  return watch({
    logFile,
    workerPid: state.pid,
    tickMs: args.tickMs,
    baseLines: state.outputLines,
  });
}

async function stopCall(args) {
  const logFile = path.resolve(args.stop);
  const statePath = stateFileOf(logFile);
  const state = readState(statePath);
  if (!state) {
    return fail(
      `상태 파일이 없음: "${statePath}". --stop에는 이 스크립트가 시작한 호출의 로그 경로를 넘겨야 함.`,
    );
  }
  if (state.result) return emitResult(state.result, logFile);

  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    // already gone; the checks below report what is left
  }

  const until = Date.now() + STOP_WAIT_MS;
  while (Date.now() < until) {
    const current = readState(statePath);
    if (current?.result) return emitResult(current.result, logFile);
    if (!pidAlive(state.pid)) break;
    await sleep(25);
  }

  const last = readState(statePath);
  if (last?.result) return emitResult(last.result, logFile);
  try {
    process.kill(-state.pid, 'SIGKILL');
  } catch {
    // nothing left to kill
  }
  return emit(
    {
      status: 'failed',
      errorMessage: `--stop 후에도 종료되지 않아 SIGKILL로 정리함. thread_id가 있으면 --resume으로 이어갈 수 있음.`,
      threadId: last?.threadId ?? null,
      elapsedSeconds: elapsedOf(last, Date.now()),
      lastActivity: lastActivityOf(last),
      logFile,
    },
    1,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) return fail(args.error);
  if (args.worker) return runWorker(args);
  if (args.stop) return stopCall(args);
  if (args.attach) return attachCall(args);
  return startCall(args);
}

main().catch((err) => fail(err.message));
