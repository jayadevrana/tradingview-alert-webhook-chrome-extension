const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tabpanel');
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginSubtitle = document.getElementById('loginSubtitle');
const pinInput = document.getElementById('pinInput');
const pinConfirm = document.getElementById('pinConfirm');
const loginSubmit = document.getElementById('loginSubmit');
const logoutBtn = document.getElementById('logoutBtn');
const statusLabel = document.getElementById('statusLabel');
const enabledToggle = document.getElementById('enabledToggle');
const webhookDisplay = document.getElementById('webhookDisplay');
const webhookForm = document.getElementById('webhookForm');
const webhookUrlInput = document.getElementById('webhookUrl');
const pinForm = document.getElementById('pinForm');
const currentPinInput = document.getElementById('currentPin');
const newPinInput = document.getElementById('newPin');
const confirmNewPinInput = document.getElementById('confirmNewPin');
const customMessageInput = document.getElementById('customMessage');
const sendCustomBtn = document.getElementById('sendCustom');
const testWebhookBtn = document.getElementById('testWebhook');
const dashboardError = document.getElementById('dashboardError');
const dashboardSuccess = document.getElementById('dashboardSuccess');
const settingsError = document.getElementById('settingsError');
const settingsSuccess = document.getElementById('settingsSuccess');
const logList = document.getElementById('logList');
const clearLogsBtn = document.getElementById('clearLogs');

let appState = {
  isLoggedIn: false,
  hasPin: false,
  webhookUrl: '',
  enabled: false,
  logs: []
};

function callBackground(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function maskWebhook(url) {
  if (!url) return 'Not set';
  try {
    const parsed = new URL(url);
    const host = parsed.host;
    const path = parsed.pathname.replace(/\/$/, '');
    const maskedPath = path.length > 8 ? `${path.slice(0, 4)}…${path.slice(-3)}` : path;
    return `${parsed.protocol}//${host}${maskedPath}`;
  } catch (e) {
    return 'Not set';
  }
}

function setStatus(enabled) {
  statusLabel.textContent = enabled ? 'Enabled' : 'Disabled';
  statusLabel.classList.toggle('status-pill--disabled', !enabled);
  enabledToggle.checked = enabled;
}

function renderLogs(logs = []) {
  logList.innerHTML = '';
  if (!logs.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No logs yet.';
    empty.className = 'muted';
    logList.appendChild(empty);
    return;
  }

  logs.forEach((log) => {
    const item = document.createElement('div');
    item.className = 'log-item';

    const top = document.createElement('div');
    top.className = 'log-top';

    const status = document.createElement('span');
    status.className = `log-status ${log.status}`;
    status.textContent = log.status === 'success' ? 'Success' : 'Fail';

    const time = document.createElement('span');
    time.className = 'log-meta';
    time.textContent = new Date(log.timestamp).toLocaleString();

    top.appendChild(time);
    top.appendChild(status);

    const message = document.createElement('p');
    message.className = 'log-message';
    message.textContent = log.message;

    const response = document.createElement('p');
    response.className = 'log-meta';
    response.textContent = `Response: ${log.response || '—'} (attempts: ${log.attempts || 0})`;

    item.appendChild(top);
    item.appendChild(message);
    item.appendChild(response);

    logList.appendChild(item);
  });
}

function showLogin(show) {
  loginScreen.classList.toggle('hidden', !show);
  document.querySelector('.tabs').classList.toggle('hidden', show);
  panels.forEach((p) => p.classList.toggle('hidden', show));
}

function clearMessages() {
  [dashboardError, dashboardSuccess, settingsError, settingsSuccess, loginError].forEach((el) => { if (el) el.textContent = ''; });
}

function switchTab(tabName) {
  tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  panels.forEach((panel) => panel.classList.toggle('active', panel.id === tabName));
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

logoutBtn.addEventListener('click', async () => {
  await callBackground('LOGOUT');
  appState.isLoggedIn = false;
  render();
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessages();
  const pin = pinInput.value.trim();
  if (!/^[0-9]{6}$/.test(pin)) {
    loginError.textContent = 'PIN must be exactly 6 digits';
    return;
  }
  try {
    if (!appState.hasPin) {
      const confirm = pinConfirm.value.trim();
      if (pin !== confirm) {
        loginError.textContent = 'PINs do not match';
        return;
      }
      const pinHash = await hashPin(pin);
      const res = await callBackground('SET_PIN_FIRST_TIME', { pinHash });
      if (!res?.ok) {
        loginError.textContent = 'Could not set PIN';
        return;
      }
      appState.isLoggedIn = true;
      appState.hasPin = true;
    } else {
      const pinHash = await hashPin(pin);
      const res = await callBackground('LOGIN', { pinHash });
      if (!res?.ok) {
        loginError.textContent = 'Incorrect PIN';
        return;
      }
      appState.isLoggedIn = true;
    }
    pinInput.value = '';
    pinConfirm.value = '';
    await fetchState();
  } catch (e) {
    loginError.textContent = 'Login failed. Try again.';
  }
});

webhookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessages();
  const url = webhookUrlInput.value.trim();
  if (!/^https:\/\//i.test(url)) {
    settingsError.textContent = 'Webhook must start with https://';
    return;
  }
  const res = await callBackground('SAVE_WEBHOOK', { webhookUrl: url });
  if (!res?.ok) {
    settingsError.textContent = 'Invalid webhook URL';
    return;
  }
  settingsSuccess.textContent = 'Webhook saved and enabled';
  appState.webhookUrl = url;
  appState.enabled = true;
  render();
});

pinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessages();
  const current = currentPinInput.value.trim();
  const next = newPinInput.value.trim();
  const confirm = confirmNewPinInput.value.trim();
  if (!/^[0-9]{6}$/.test(current) || !/^[0-9]{6}$/.test(next)) {
    settingsError.textContent = 'PINs must be 6 digits';
    return;
  }
  if (next !== confirm) {
    settingsError.textContent = 'New PINs do not match';
    return;
  }
  const currentHash = await hashPin(current);
  const newHash = await hashPin(next);
  const res = await callBackground('CHANGE_PIN', { currentHash, newHash });
  if (!res?.ok) {
    settingsError.textContent = 'Current PIN incorrect';
    return;
  }
  settingsSuccess.textContent = 'PIN updated';
  currentPinInput.value = '';
  newPinInput.value = '';
  confirmNewPinInput.value = '';
});

enabledToggle.addEventListener('change', async (event) => {
  await callBackground('TOGGLE_ENABLED', { enabled: event.target.checked });
  appState.enabled = event.target.checked;
  render();
});

sendCustomBtn.addEventListener('click', async () => {
  clearMessages();
  const message = customMessageInput.value.trim();
  if (!message) {
    dashboardError.textContent = 'Enter a message to send.';
    return;
  }
  const res = await callBackground('SEND_CUSTOM', { message });
  if (res?.ok) {
    dashboardSuccess.textContent = 'Sent to webhook.';
    customMessageInput.value = '';
    fetchLogs();
  } else {
    dashboardError.textContent = res?.responseText || 'Failed to send.';
  }
});

testWebhookBtn.addEventListener('click', async () => {
  clearMessages();
  const message = customMessageInput.value.trim() || 'TEST ALERT: webhook connectivity check';
  const res = await callBackground('TEST_WEBHOOK', { message });
  if (res?.ok) {
    dashboardSuccess.textContent = 'Test sent successfully.';
  } else {
    dashboardError.textContent = res?.responseText || 'Test failed.';
  }
  fetchLogs();
});

clearLogsBtn.addEventListener('click', async () => {
  await callBackground('CLEAR_LOGS');
  appState.logs = [];
  renderLogs([]);
});

async function fetchState() {
  const state = await callBackground('INIT_STATE');
  appState = { ...appState, ...state };
  render();
}

async function fetchLogs() {
  const res = await callBackground('GET_LOGS');
  appState.logs = res?.logs || [];
  renderLogs(appState.logs);
}

function render() {
  clearMessages();
  if (!appState.isLoggedIn) {
    showLogin(true);
    loginSubtitle.textContent = appState.hasPin ? 'Enter your 6-digit PIN to unlock.' : 'Set a 6-digit PIN to unlock the extension.';
    pinConfirm.classList.toggle('hidden', appState.hasPin);
    loginSubmit.textContent = appState.hasPin ? 'Unlock' : 'Set PIN';
    return;
  }

  showLogin(false);
  setStatus(appState.enabled);
  webhookDisplay.textContent = maskWebhook(appState.webhookUrl);
  webhookUrlInput.value = appState.webhookUrl;
  renderLogs(appState.logs);
}

(async function init() {
  await fetchState();
})();
