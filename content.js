const CS_PREFIX = '[TV Forwarder][CS]';
const FALLBACK_INTERVAL_MS = 1500;
const LOCAL_DEDUP_WINDOW = 10_000;
const localRecent = new Map();

function logDebug(...args) {
  // Toggle-able debug; left on for development
  console.log(CS_PREFIX, ...args);
}

function isLikelyAlertContainer(el) {
  if (!el || el.nodeType !== 1) return false;
  const cls = el.className || '';
  const dataName = el.getAttribute?.('data-name') || '';
  const role = el.getAttribute?.('role') || '';
  return /toast|notification|popup|alert|modal|tv-alert|bubble/i.test(cls) ||
    (dataName && /alert/i.test(dataName)) ||
    role === 'alert';
}

function recordLocal(message) {
  const now = Date.now();
  const last = localRecent.get(message);
  if (last && now - last < LOCAL_DEDUP_WINDOW) return false;
  localRecent.set(message, now);
  return true;
}

function sendAlert(message) {
  if (!message || !recordLocal(message)) return;
  chrome.runtime.sendMessage({ type: 'ALERT_TRIGGERED', payload: { message } });
  logDebug('Alert sent to background', message);
}

function extractContainerText(node) {
  const text = node.textContent || '';
  if (!isAlertPayload(text)) return null;
  let container = node;
  while (container && !isLikelyAlertContainer(container)) {
    container = container.parentElement;
  }
  return (container || node).textContent?.trim() || null;
}

function isAlertPayload(text = '') {
  const trimmed = text.trim();
  // Only forward messages that look like JSON array objects: starts with [{
  if (/^\[\{/.test(trimmed)) return true;
  // fallback: also allow typical keyword alerts that are JSON-like
  return false;
}

function handleMutations(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType !== 1) continue;
      const fullMessage = extractContainerText(node);
      if (fullMessage) {
        sendAlert(fullMessage);
        return; // avoid duplicate sends within same batch
      }
    }
  }
}

function startObserver() {
  const target = document.body;
  if (!target) return;
  const observer = new MutationObserver(handleMutations);
  observer.observe(target, { childList: true, subtree: true });
  logDebug('MutationObserver attached');
}

function fallbackScan() {
  const candidates = document.querySelectorAll('[role="alert"], .tv-alert, .notification, .toast, .popup, .alert');
  candidates.forEach((node) => {
    const text = node.textContent?.trim() || '';
    if (isAlertPayload(text)) {
      sendAlert(text);
    }
  });
}

function initFallbackLoop() {
  setInterval(fallbackScan, FALLBACK_INTERVAL_MS);
  logDebug('Fallback scanner running every', FALLBACK_INTERVAL_MS, 'ms');
}

function waitForBody() {
  if (document.body) {
    startObserver();
    initFallbackLoop();
  } else {
    const observer = new MutationObserver(() => {
      if (document.body) {
        startObserver();
        initFallbackLoop();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

(function bootstrap() {
  logDebug('Content script booting');
  waitForBody();
})();
