/**
 * Zero-dependency CDP (Chrome DevTools Protocol) bridge using Node.js 22 native WebSocket & fetch.
 */

export async function listCdpTargets(port, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: controller.signal
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function selectAntigravityTargets(targets) {
  return targets.filter((t) => {
    if (!t || t.type !== 'page' || !t.webSocketDebuggerUrl) return false;
    const url = String(t.url || '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    return true;
  });
}

export class CdpPageSession {
  constructor(target, { onBindingCall, onClose, logger } = {}) {
    this.target = target;
    this.wsUrl = target.webSocketDebuggerUrl;
    this.onBindingCall = onBindingCall || null;
    this.onClose = onClose || null;
    this.logger = logger || (() => {});
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  async connect(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error(`CDP connect timeout: ${this.wsUrl}`));
      }, timeoutMs);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(this);
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket error: ${err?.message || 'unknown'}`));
      });

      ws.addEventListener('message', (event) => {
        this._handleMessage(event.data);
      });

      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('CDP socket closed'));
        }
        this.pending.clear();
        if (this.onClose) this.onClose(this);
      });
    });
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      return;
    }

    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    if (msg.method === 'Runtime.bindingCalled' && this.onBindingCall) {
      const { name, payload } = msg.params || {};
      if (name === '__AG_ZH_BRIDGE__') {
        try {
          const parsed = JSON.parse(payload);
          this.onBindingCall(parsed, this);
        } catch (err) {
          this.logger('Invalid binding payload:', err.message);
        }
      }
    }
  }

  send(method, params = {}, timeoutMs = 8000) {
    if (!this.ws || this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP session is not open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setupBridge() {
    await this.send('Runtime.enable');
    await this.send('Runtime.addBinding', { name: '__AG_ZH_BRIDGE__' });
  }

  async evaluate(expression, { awaitPromise = false, returnByValue = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue
    });
    if (res?.exceptionDetails) {
      const text = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed';
      throw new Error(text);
    }
    return res?.result?.value;
  }

  async pushToPage(message) {
    const serialized = JSON.stringify(message);
    return this.evaluate(
      `typeof window.__AG_ZH_ON_DAEMON_MSG__ === 'function' && window.__AG_ZH_ON_DAEMON_MSG__(${serialized});`
    );
  }

  close() {
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
  }
}
