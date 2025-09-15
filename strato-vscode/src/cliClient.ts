// src/cliClient.ts
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as readline from 'node:readline';
import { EventEmitter } from 'node:events';

type Json = any;

export interface CliClientOptions {
  /** Absolute or PATH-resolved tool name */
  command: string;
  /** Arguments to the tool (if any) */
  args?: string[];
  /** Working directory for the tool */
  cwd?: string;
  /** Extra env vars (PATH, etc.) */
  env?: NodeJS.ProcessEnv;
  /** If true, use DAP 'Content-Length' framing instead of JSONL */
  useContentLengthFraming?: boolean;
  /** Optional logger */
  log?: (msg: string) => void;
  /** Kill the child on dispose()? Default true */
  killOnDispose?: boolean;
}

/**
 * Minimal JSON-RPC-ish client over stdio.
 * - Correlates requests by `id`.
 * - Supports notifications (no `id`).
 * - Supports either JSONL framing or DAP Content-Length framing.
 */
export class CliClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: any) => void }>();
  private disposed = false;
  private useContentLength: boolean;
  private log?: (m: string) => void;

  // DAP frame buffer
  private headerBuf = '';
  private bodyBytesRemaining = 0;
  private bodyBuffers: Buffer[] = [];

  constructor(private opts: CliClientOptions) {
    super();
    this.useContentLength = !!opts.useContentLengthFraming;
    this.log = opts.log;

    // Spawn with pipes (avoids exec buffer limits).
    this.child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.on('error', (err) => {
      this.log?.(`[cli] error: ${String(err)}`);
      this.rejectAllPending(err);
      this.emit('error', err);
    });

    this.child.on('exit', (code, signal) => {
      this.log?.(`[cli] exit code=${code} signal=${signal}`);
      this.rejectAllPending(new Error(`CLI exited (code=${code}, signal=${signal})`));
      this.emit('exit', { code, signal });
    });

    // STDERR → log
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      chunk.split(/\r?\n/).forEach(line => {
        if (line.trim()) this.log?.(`[cli][stderr] ${line}`);
      });
    });

    // STDOUT framing
    if (this.useContentLength) {
      // Read raw bytes → parse DAP frames
      this.child.stdout.on('data', (buf: Buffer) => this.onStdoutBuffer(buf));
    } else {
      // JSONL: 1 message per line
      const rl = readline.createInterface({ input: this.child.stdout });
      rl.on('line', (line) => this.onStdoutLine(line));
      rl.on('close', () => {
          this.log?.('[cli] stdout closed');
          this.emit('exit', {});
      });
    }
  }

  /** Send a request and await a response */
  send(method: string, params?: Json): Promise<Json> {
    if (this.disposed) return Promise.reject(new Error('CliClient disposed'));
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };

    this.writeMessage(msg);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  /** Send a notification (no response expected) */
  notify(method: string, params?: Json): void {
    if (this.disposed) return;
    const msg = { jsonrpc: '2.0', method, params };
    this.writeMessage(msg);
  }

  /** Graceful shutdown */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      // Give the tool a chance to exit cleanly
      this.child.stdin.end();
    } catch {}
    if (this.opts.killOnDispose ?? true) {
      try { this.child.kill(); } catch {}
    }
  }

  // --- Internals ---

  private writeMessage(msg: Json) {
    const payload = Buffer.from(JSON.stringify(msg), 'utf8');

    if (this.useContentLength) {
      // DAP framing
      const header = Buffer.from(`Content-Length: ${payload.byteLength}\r\n\r\n`, 'utf8');
      this.child.stdin.write(header);
      this.child.stdin.write(payload);
    } else {
      // JSONL framing
      this.child.stdin.write(payload);
      this.child.stdin.write('\n');
    }

    this.log?.(`[cli][→] ${JSON.stringify(msg)}`);
  }

  private onStdoutLine(line: string) {
    if (!line.trim()) return;
    this.log?.(`[cli][←] ${line}`);
    this.handleMessage(line);
  }

  // Parse DAP frames: "Content-Length: N\r\n\r\n<bytes>"
  private onStdoutBuffer(buf: Buffer) {
    let offset = 0;
    while (offset < buf.length) {
      if (this.bodyBytesRemaining === 0) {
        // parse headers
        this.headerBuf += buf.toString('utf8', offset, buf.length);
        const sepIndex = this.headerBuf.indexOf('\r\n\r\n');
        if (sepIndex === -1) {
          // need more header bytes
          break;
        }
        const headers = this.headerBuf.slice(0, sepIndex);
        this.headerBuf = this.headerBuf.slice(sepIndex + 4); // drop CRLFCRLF

        const match = headers.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.log?.(`[cli] Invalid frame headers: ${headers}`);
          return;
        }
        this.bodyBytesRemaining = parseInt(match[1], 10);

        // If headerBuf has leftover bytes from previous chunk, treat them as body prefix
        if (this.headerBuf.length > 0) {
          const leftover = Buffer.from(this.headerBuf, 'utf8');
          this.headerBuf = '';
          const use = Math.min(leftover.length, this.bodyBytesRemaining);
          this.bodyBuffers.push(leftover.subarray(0, use));
          this.bodyBytesRemaining -= use;
          if (leftover.length > use) {
            // There are extra bytes beyond the current body; push them back into flow
            const rest = leftover.subarray(use);
            // Recurse by re-invoking with remaining bytes
            this.onStdoutBuffer(rest);
            return;
          }
        }
        // Done parsing headers; continue loop without advancing offset
        return;
      } else {
        // accumulate body bytes
        const need = this.bodyBytesRemaining;
        const available = buf.length - offset;
        const take = Math.min(need, available);
        this.bodyBuffers.push(buf.subarray(offset, offset + take));
        this.bodyBytesRemaining -= take;
        offset += take;

        if (this.bodyBytesRemaining === 0) {
          const body = Buffer.concat(this.bodyBuffers);
          this.bodyBuffers = [];
          const text = body.toString('utf8');
          this.log?.(`[cli][←] ${text}`);
          this.handleMessage(text);
          // continue loop to parse next frame (if any)
        }
      }
    }
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      this.log?.(`[cli] JSON parse error: ${String(e)} :: ${raw}`);
      return;
    }

    // JSON-RPC 2.0: either response {id, result/error} or notification {method}
    if (typeof msg?.id === 'number' || typeof msg?.id === 'string') {
      const idNum = Number(msg.id);
      const pending = this.pending.get(idNum);
      if (pending) {
        this.pending.delete(idNum);
        if ('error' in msg && msg.error) {
          pending.reject(Object.assign(new Error(msg.error?.message ?? 'CLI error'), { data: msg.error }));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg?.method) {
      // Notification/event from tool
      this.emit('notification', msg.method, msg.params);
    }
  }

  private rejectAllPending(err: any) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}
