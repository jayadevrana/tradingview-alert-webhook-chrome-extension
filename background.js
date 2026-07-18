const STORAGE_KEYS = {
  webhookUrl: 'webhookUrl',
  enabled: 'enabled',
  pinHash: 'pinHash',
  isLoggedIn: 'isLoggedIn',
  logs: 'logs'
};

const MAX_LOGS = 100;
const DEDUP_WINDOW_MS = 30_000;
const recentAlerts = new Map();

function nowIso() {
  return new Date().toISOString();
}

function isValidWebhook(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function cleanRecentAlerts() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [msg, ts] of recentAlerts.entries()) {
    if (ts < cutoff) recentAlerts.delete(msg);
  }
}

function shouldProcess(message) {
  cleanRecentAlerts();
  const key = (message || '').trim();
  if (!key) return false;
  const last = recentAlerts.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) {
    return false;
  }
  recentAlerts.set(key, Date.now());
  return true;
}

function extractSymbol(message = '') {
  // Heuristic: pick first token that looks like a trading symbol
  const candidates = message.match(/\b[A-Z]{2,10}(?:[:./-][A-Z]{2,10})?\b/g);
  if (!candidates) return undefined;
  // Prefer tokens containing separators like / or : which often denote pairs
  const prioritized = candidates.find((c) => /[:./-]/.test(c));
  return prioritized || candidates[0];
}

function truncate(str = '', max = 100) {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

async function readState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      Object.values(STORAGE_KEYS),
      (result) => resolve({
        webhookUrl: result[STORAGE_KEYS.webhookUrl] || '',
        enabled: result[STORAGE_KEYS.enabled] !== false,
        pinHash: result[STORAGE_KEYS.pinHash] || '',
        isLoggedIn: result[STORAGE_KEYS.isLoggedIn] === true,
        logs: result[STORAGE_KEYS.logs] || []
      })
    );
  });
}

async function saveState(patch) {
  return new Promise((resolve) => {
    chrome.storage.local.set(patch, () => resolve(true));
  });
}

async function appendLog(entry) {
  const state = await readState();
  const logs = [entry, ...(state.logs || [])].slice(0, MAX_LOGS);
  await saveState({ [STORAGE_KEYS.logs]: logs });
}

async function clearLogs() {
  await saveState({ [STORAGE_KEYS.logs]: [] });
}

async function sendToWebhook(message, { test = false, manual = false } = {}) {
  const state = await readState();
  const url = state.webhookUrl;
  if (!isValidWebhook(url)) {
    return { ok: false, status: 'invalid-webhook', responseText: 'Webhook missing or invalid', attempts: 0 };
  }
  // Send exactly what we received—no wrapper, no extra fields
  const body = typeof message === 'string' ? message : JSON.stringify(message);

  const backoffs = [1000, 2000, 4000];
  let attempts = 0;
  let lastError = '';

  for (const delay of backoffs) {
    attempts += 1;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body
      });
      const text = await response.text();
      if (response.ok) {
        return { ok: true, status: response.status, responseText: truncate(text || 'OK'), attempts };
      }
      lastError = `HTTP ${response.status}: ${truncate(text || '')}`;
    } catch (err) {
      lastError = err && err.message ? err.message : 'Network error';
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  return { ok: false, status: lastError || 'failed', responseText: truncate(lastError || 'Failed'), attempts: backoffs.length };
}

async function handleAlert(message) {
  const state = await readState();
  if (!state.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!shouldProcess(message)) {
    return { ok: false, skipped: true, reason: 'duplicate' };
  }
  const result = await sendToWebhook(message, { test: false, manual: false });
  await appendLog({
    timestamp: Date.now(),
    message,
    status: result.ok ? 'success' : 'fail',
    response: result.responseText,
    attempts: result.attempts,
    type: 'alert'
  });
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const { type, payload } = message || {};
    switch (type) {
      case 'ALERT_TRIGGERED': {
        const alertMessage = payload?.message || message.message || '';
        const result = await handleAlert(alertMessage);
        sendResponse(result);
        break;
      }
      case 'INIT_STATE': {
        const state = await readState();
        sendResponse({
          webhookUrl: state.webhookUrl,
          enabled: state.enabled,
          isLoggedIn: state.isLoggedIn,
          hasPin: Boolean(state.pinHash),
          logs: state.logs
        });
        break;
      }
      case 'LOGIN': {
        const state = await readState();
        const ok = state.pinHash && payload?.pinHash && payload.pinHash === state.pinHash;
        if (ok) {
          await saveState({ [STORAGE_KEYS.isLoggedIn]: true });
        }
        sendResponse({ ok });
        break;
      }
      case 'SET_PIN_FIRST_TIME': {
        const state = await readState();
        if (state.pinHash) {
          sendResponse({ ok: false, error: 'pin-already-set' });
          break;
        }
        if (!payload?.pinHash) {
          sendResponse({ ok: false, error: 'pin-missing' });
          break;
        }
        await saveState({
          [STORAGE_KEYS.pinHash]: payload.pinHash,
          [STORAGE_KEYS.isLoggedIn]: true
        });
        sendResponse({ ok: true });
        break;
      }
      case 'CHANGE_PIN': {
        const state = await readState();
        const matches = state.pinHash && payload?.currentHash === state.pinHash;
        if (!matches) {
          sendResponse({ ok: false, error: 'invalid-current-pin' });
          break;
        }
        await saveState({ [STORAGE_KEYS.pinHash]: payload?.newHash });
        sendResponse({ ok: true });
        break;
      }
      case 'LOGOUT': {
        await saveState({ [STORAGE_KEYS.isLoggedIn]: false });
        sendResponse({ ok: true });
        break;
      }
      case 'SAVE_WEBHOOK': {
        const url = payload?.webhookUrl || '';
        if (!isValidWebhook(url)) {
          sendResponse({ ok: false, error: 'invalid-webhook' });
          break;
        }
        await saveState({ [STORAGE_KEYS.webhookUrl]: url, [STORAGE_KEYS.enabled]: true });
        sendResponse({ ok: true });
        break;
      }
      case 'TOGGLE_ENABLED': {
        const enabled = payload?.enabled === true;
        await saveState({ [STORAGE_KEYS.enabled]: enabled });
        sendResponse({ ok: true });
        break;
      }
      case 'GET_LOGS': {
        const state = await readState();
        sendResponse({ logs: state.logs || [] });
        break;
      }
      case 'CLEAR_LOGS': {
        await clearLogs();
        sendResponse({ ok: true });
        break;
      }
      case 'TEST_WEBHOOK': {
        const customMessage = payload?.message || 'TEST ALERT: TradingView webhook check';
        const result = await sendToWebhook(customMessage, { test: true, manual: true });
        await appendLog({
          timestamp: Date.now(),
          message: customMessage,
          status: result.ok ? 'success' : 'fail',
          response: result.responseText,
          attempts: result.attempts,
          type: 'test'
        });
        sendResponse(result);
        break;
      }
      case 'SEND_CUSTOM': {
        const customMessage = payload?.message || '';
        if (!customMessage.trim()) {
          sendResponse({ ok: false, error: 'empty-message' });
          break;
        }
        const result = await sendToWebhook(customMessage, { test: false, manual: true });
        await appendLog({
          timestamp: Date.now(),
          message: customMessage,
          status: result.ok ? 'success' : 'fail',
          response: result.responseText,
          attempts: result.attempts,
          type: 'manual'
        });
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown-message' });
    }
  })();
  return true; // keep the message channel open for async responses
});
