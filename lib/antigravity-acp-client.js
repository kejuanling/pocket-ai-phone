'use strict';
// ACP client for official antigravity-acp binary (agy_acp_server.par).
// JSON-RPC over stdio. Personal chat use only. No probes.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const BINARY = path.join(__dirname, '..', 'bin', 'antigravity-acp', 'agy_acp_server.par');

class AntigravityAcpClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.binary = opts.binary || BINARY;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.buffer = '';
    this.ready = false;
    this.sessions = new Map(); // sessionId -> {chunks: [], done: false}
  }

  start() {
    if (this.proc) return Promise.resolve();
    if (!fs.existsSync(this.binary)) {
      return Promise.reject(new Error('ACP binary not found: ' + this.binary));
    }
    this.proc = spawn(this.binary, ['--uid='], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: process.env.HOME || '/root' },
    });
    this.proc.stdout.on('data', (chunk) => this._onData(chunk.toString()));
    this.proc.stderr.on('data', (d) => this.emit('stderr', d.toString()));
    this.proc.on('exit', (code) => {
      this.emit('exit', code);
      this.proc = null;
      this.ready = false;
      for (const p of this.pending.values()) p.reject(new Error('ACP process exited'));
      this.pending.clear();
    });
    return this.initialize();
  }

  _onData(text) {
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        } else if (msg.method) {
          this._handleNotification(msg);
        }
      } catch (e) {
        this.emit('parse-error', line.slice(0, 200), e.message);
      }
    }
  }

  _handleNotification(msg) {
    const { method, params } = msg;
    this.emit('notification', method, params);

    // Common streaming updates for chat
    if (method === 'session/update' && params && params.sessionId) {
      const sid = params.sessionId;
      let sess = this.sessions.get(sid);
      if (!sess) {
        sess = { chunks: [], done: false };
        this.sessions.set(sid, sess);
      }
      if (params.update) {
        const u = params.update;
        if (u.sessionUpdate === 'agent_message_chunk' && u.content && u.content.type === 'text') {
          sess.chunks.push(u.content.text);
          this.emit('chunk', sid, u.content.text);
        } else if (u.sessionUpdate === 'agent_message_complete' || u.sessionUpdate === 'done') {
          sess.done = true;
          this.emit('complete', sid, sess.chunks.join(''));
        }
      }
    }
  }

  request(method, params) {
    if (!this.proc) return Promise.reject(new Error('not started'));
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params: params || {} };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.proc.stdin.write(JSON.stringify(msg) + '\n');
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'dylan-phone', version: '0.1' },
      capabilities: { promptCapabilities: { image: true } },
    });
    this.ready = true;
    this.emit('ready', result);
    return result;
  }

  async newSession(opts = {}) {
    const params = Object.assign({
      cwd: opts.cwd || '/tmp',
      mcpServers: opts.mcpServers || [],
    }, opts);
    const result = await this.request('session/new', params);
    const sid = result && (result.sessionId || result.id);
    if (sid) this.sessions.set(sid, { chunks: [], done: false });
    return result;
  }

  /**
   * Send a text prompt and collect the full response (waits for complete).
   * Also emits 'chunk' events for streaming.
   */
  async prompt(sessionId, text, opts = {}) {
    const sess = this.sessions.get(sessionId) || { chunks: [], done: false };
    this.sessions.set(sessionId, sess);
    sess.chunks = [];
    sess.done = false;

    const req = this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
      ...(opts.model ? { model: opts.model } : {}),
    });

    // Wait for either the request result or the complete event
    const completePromise = new Promise((resolve) => {
      const onComplete = (sid, full) => {
        if (sid === sessionId) {
          this.off('complete', onComplete);
          resolve(full);
        }
      };
      this.on('complete', onComplete);
      // fallback timeout
      setTimeout(() => {
        this.off('complete', onComplete);
        resolve(sess.chunks.join('') || null);
      }, opts.timeout || 120000);
    });

    const [reqResult, streamed] = await Promise.all([req.catch(e => ({ error: e.message })), completePromise]);
    return {
      requestResult: reqResult,
      text: streamed || sess.chunks.join(''),
      chunks: sess.chunks,
    };
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.ready = false;
  }
}

module.exports = { AntigravityAcpClient, BINARY };
