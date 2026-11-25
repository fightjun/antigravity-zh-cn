// 00-bootstrap.js: Runtime namespace, cleanup for hot-reload, and CDP RPC bridge.
const NS_KEY = '__AG_ZH_CN__';

// Clean up previous runtime instance during hot-reload
if (window[NS_KEY] && typeof window[NS_KEY].dispose === 'function') {
  try {
    window[NS_KEY].dispose();
  } catch {
    // Ignore cleanup errors on hot-reload
  }
}

const pendingRpc = new Map();
let rpcSeq = 1;
const eventListeners = new Set();

function callDaemon(action, payload = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (typeof window.__AG_ZH_BRIDGE__ !== 'function') {
      reject(new Error('CDP bridge is not attached'));
      return;
    }
    const id = rpcSeq++;
    const timer = setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`Daemon RPC timeout: ${action}`));
    }, timeoutMs);

    pendingRpc.set(id, { resolve, reject, timer });
    try {
      window.__AG_ZH_BRIDGE__(JSON.stringify({ id, action, payload }));
    } catch (err) {
      clearTimeout(timer);
      pendingRpc.delete(id);
      reject(err);
    }
  });
}

window.__AG_ZH_ON_DAEMON_MSG__ = function (msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'response' && pendingRpc.has(msg.id)) {
    const entry = pendingRpc.get(msg.id);
    pendingRpc.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg.data);
    } else {
      entry.reject(new Error(msg.error || 'Daemon RPC failed'));
    }
    return;
  }
  if (msg.type === 'event') {
    for (const fn of eventListeners) {
      try {
        fn(msg.event, msg.payload);
      } catch {
        // Ignore listener error
      }
    }
  }
};

const AG_ZH = {
  boot: __AG_ZH_BOOT__,
  status: __AG_ZH_BOOT__.status || {},
  config: (__AG_ZH_BOOT__.status && __AG_ZH_BOOT__.status.config) || { enabled: true },
  callDaemon,
  onDaemonEvent(fn) {
    eventListeners.add(fn);
    return () => eventListeners.delete(fn);
  },
  disposers: [],
  addDisposer(fn) {
    this.disposers.push(fn);
  },
  dispose() {
    for (const fn of this.disposers.splice(0)) {
      try {
        fn();
      } catch {
        // Ignore
      }
    }
    for (const [, entry] of pendingRpc) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Runtime reloaded'));
    }
    pendingRpc.clear();
    eventListeners.clear();
  }
};

window[NS_KEY] = AG_ZH;
