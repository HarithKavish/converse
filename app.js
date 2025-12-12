// Basic frontend-only chat with Google login and Google Drive appData storage.

const GOOGLE_CLIENT_ID = '59648450302-sqkk4pdujkt4hrm0uuhq95pq55b4jg2k.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_NAME = 'chat_history.json';

const state = {
    currentUser: null,
    peerEmail: null,
    messages: loadMessages(),
    googleReady: null,
    drive: {
        accessToken: null,
        fileId: null,
        status: 'idle',
    },
};

const els = {
    userCard: document.getElementById('user-card'),
    peerLabel: document.getElementById('chat-peer'),
    status: document.getElementById('auth-status'),
    messages: document.getElementById('messages'),
    messageInput: document.getElementById('message-input'),
    messageForm: document.getElementById('message-form'),
    startChatForm: document.getElementById('start-chat-form'),
    peerEmailInput: document.getElementById('peer-email'),
    googleLoginContainer: document.getElementById('google-login-container'),
    logoutBtn: document.getElementById('logout'),
};

function loadMessages() {
    try {
        const raw = localStorage.getItem('chat-app-messages');
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.warn('Failed to load messages', err);
        return {};
    }
}

function persistMessages() {
    localStorage.setItem('chat-app-messages', JSON.stringify(state.messages));
}

function setDriveStatus(status) {
    state.drive.status = status;
    updateAuthStatus();
}

function chatKey(emailA, emailB) {
    const a = (emailA || '').trim().toLowerCase();
    const b = (emailB || '').trim().toLowerCase();
    return [a, b].sort().join('::');
}

function setCurrentUser(user) {
    state.currentUser = user;
    renderUserCard();
    updateAuthStatus();
    toggleAuthButtons();
    renderMessages();
    if (user) {
        localStorage.setItem('chat-app-current-user', JSON.stringify(user));
    } else {
        localStorage.removeItem('chat-app-current-user');
    }
}

function renderUserCard() {
    if (!state.currentUser) {
        els.userCard.classList.add('empty');
        els.userCard.innerHTML = 'Not signed in';
        return;
    }
    const { name, email, picture } = state.currentUser;
    els.userCard.classList.remove('empty');
    els.userCard.innerHTML = `
    ${picture ? `<img src="${picture}" alt="avatar" />` : ''}
    <div class="meta">
      <div class="name">${name || 'Anonymous'}</div>
      <div class="email">${email}</div>
    </div>
  `;
}

function updateAuthStatus() {
    if (!state.currentUser) {
        els.status.textContent = 'Signed out';
        return;
    }
    const driveState = state.drive.status;
    const driveLabel = driveState === 'idle' ? 'Drive idle' : `Drive ${driveState}`;
    els.status.textContent = `Signed in • ${driveLabel}`;
}

function toggleAuthButtons() {
    const signedIn = Boolean(state.currentUser);
    els.googleLoginContainer.style.display = signedIn ? 'none' : 'block';
    els.logoutBtn.hidden = !signedIn;
}

function setPeer(email) {
    state.peerEmail = email;
    els.peerLabel.textContent = email || 'No peer selected';
    renderMessages();
    if (email) {
        localStorage.setItem('chat-app-peer', email);
    } else {
        localStorage.removeItem('chat-app-peer');
    }
}

function setMessages(newMessages) {
    state.messages = newMessages || {};
    persistMessages();
    renderMessages();
}

function renderMessages() {
    const container = els.messages;
    container.innerHTML = '';
    if (!state.currentUser) {
        container.innerHTML = '<div class="empty">Sign in and choose a peer to start messaging.</div>';
        return;
    }
    if (!state.peerEmail) {
        container.innerHTML = '<div class="empty">Enter a peer email to start chatting.</div>';
        return;
    }
    const key = chatKey(state.currentUser.email, state.peerEmail);
    const thread = state.messages[key] || [];
    if (!thread.length) {
        container.innerHTML = '<div class="empty">No messages yet. Say hello!</div>';
        return;
    }
    thread.forEach((msg) => {
        const bubble = document.createElement('div');
        const fromMe = msg.from === state.currentUser.email;
        bubble.className = `bubble ${fromMe ? 'from-me' : 'from-them'}`;
        bubble.innerHTML = `
      <div>${msg.text}</div>
      <span class="timestamp">${new Date(msg.timestamp).toLocaleString()}</span>
    `;
        container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
}

function appendMessage(text) {
    if (!state.currentUser || !state.peerEmail) return;
    const key = chatKey(state.currentUser.email, state.peerEmail);
    if (!state.messages[key]) state.messages[key] = [];
    state.messages[key].push({
        from: state.currentUser.email,
        to: state.peerEmail,
        text,
        timestamp: Date.now(),
    });
    persistMessages();
    renderMessages();
    // Best-effort cloud sync (not awaited to keep UI snappy)
    syncToDrive().catch((err) => console.warn('Drive sync failed', err));
}

function handleSend(e) {
    e.preventDefault();
    if (!state.currentUser) {
        alert('Sign in first.');
        return;
    }
    const text = els.messageInput.value.trim();
    if (!text) return;
    appendMessage(text);
    els.messageInput.value = '';
    els.messageInput.focus();
}

function handleStartChat(e) {
    e.preventDefault();
    const peer = els.peerEmailInput.value.trim();
    if (!peer) return;
    setPeer(peer);
}

function decodeJwt(token) {
    try {
        const payload = token.split('.')[1];
        return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (err) {
        console.warn('Failed to decode token', err);
        return null;
    }
}

function googleReadyPromise(timeoutMs = 20000, intervalMs = 100) {
    if (state.googleReady) return state.googleReady;
    state.googleReady = new Promise((resolve, reject) => {
        const started = Date.now();

        function check() {
            if (window.google?.accounts?.id) {
                resolve(true);
                return true;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error('Google Identity Services script not ready'));
                return true;
            }
            return false;
        }

        // First immediate check
        if (check()) return;

        const timer = setInterval(() => {
            if (check()) {
                clearInterval(timer);
            }
        }, intervalMs);

        // If the GIS script tag fires onload, we resolve quickly.
        window.onGoogleLibraryLoad = () => {
            if (window.google?.accounts?.id) {
                clearInterval(timer);
                resolve(true);
            }
        };
    });
    return state.googleReady;
}

function handleCredentialResponse(response) {
    const payload = decodeJwt(response.credential);
    if (!payload?.email) return;
    setCurrentUser({
        email: payload.email,
        name: payload.name || payload.given_name || payload.family_name || 'Google User',
        picture: payload.picture,
        provider: 'google',
    });
    // After sign-in, bootstrap Drive storage and hydrate messages
    bootstrapDriveSync();
}

// Make callback globally accessible for HTML API
window.handleCredentialResponse = handleCredentialResponse;

function initGoogle() {
    // With HTML API, the button is rendered automatically by the GIS script.
    // We just need to ensure the callback is available and handle the signed-in state.

    // Hide the button container if user is already signed in
    if (state.currentUser) {
        els.googleLoginContainer.style.display = 'none';
    }

    // Optionally trigger One Tap prompt for better UX
    googleReadyPromise()
        .then(() => {
            if (!state.currentUser) {
                window.google.accounts.id.prompt();
            }
        })
        .catch((err) => {
            console.warn('Google One Tap not available:', err.message);
        });
}

function logout() {
    if (state.currentUser?.provider === 'google' && window.google?.accounts?.id) {
        window.google.accounts.id.revoke(state.currentUser.email, () => { });
    }
    setCurrentUser(null);
    state.drive = { accessToken: null, fileId: null, status: 'idle' };
}

function initUI() {
    els.messageForm.addEventListener('submit', handleSend);
    els.startChatForm.addEventListener('submit', handleStartChat);
    els.logoutBtn.addEventListener('click', logout);
    toggleAuthButtons();
}

function restoreLastSession() {
    try {
        const raw = localStorage.getItem('chat-app-current-user');
        if (raw) {
            const parsed = JSON.parse(raw);
            setCurrentUser(parsed);
        }
        const peer = localStorage.getItem('chat-app-peer');
        if (peer) setPeer(peer);
    } catch (err) {
        console.warn('Failed to restore session', err);
    }
}

// Persist session changes
window.addEventListener('beforeunload', () => {
    if (state.currentUser) {
        localStorage.setItem('chat-app-current-user', JSON.stringify(state.currentUser));
    } else {
        localStorage.removeItem('chat-app-current-user');
    }
    if (state.peerEmail) {
        localStorage.setItem('chat-app-peer', state.peerEmail);
    }
});

function main() {
    initUI();
    restoreLastSession();
    if (state.currentUser) {
        bootstrapDriveSync();
    }
    initGoogle();
    renderMessages();
}

// -------- Google Drive appData helpers --------
let tokenClient;

function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        prompt: '',
        callback: (resp) => {
            if (resp.error) {
                tokenRequestReject && tokenRequestReject(resp);
            } else {
                tokenRequestResolve && tokenRequestResolve(resp.access_token);
            }
            tokenRequestResolve = null;
            tokenRequestReject = null;
        },
    });
    return tokenClient;
}

let tokenRequestResolve = null;
let tokenRequestReject = null;

function requestDriveToken() {
    return new Promise((resolve, reject) => {
        tokenRequestResolve = resolve;
        tokenRequestReject = reject;
        ensureTokenClient().requestAccessToken({ prompt: '' });
    });
}

async function getAccessToken() {
    if (state.drive.accessToken) return state.drive.accessToken;
    await googleReadyPromise();
    setDriveStatus('auth');
    const token = await requestDriveToken();
    state.drive.accessToken = token;
    setDriveStatus('idle');
    return token;
}

async function driveFetch(url, options = {}) {
    const token = await getAccessToken();
    const resp = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });
    if (!resp.ok) {
        throw new Error(`Drive API error ${resp.status}`);
    }
    return resp;
}

async function findDriveFileId() {
    if (state.drive.fileId) return state.drive.fileId;
    const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and 'appDataFolder' in parents`);
    const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder&fields=files(id,name)`);
    const data = await resp.json();
    const file = data.files?.[0];
    if (file?.id) {
        state.drive.fileId = file.id;
        return file.id;
    }
    return null;
}

async function createDriveFile(initialData = {}) {
    const metadata = {
        name: DRIVE_FILE_NAME,
        parents: ['appDataFolder'],
    };
    const body = buildMultipartBody(metadata, initialData);
    const resp = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': body.type },
        body,
    });
    const json = await resp.json();
    state.drive.fileId = json.id;
    return json.id;
}

function buildMultipartBody(metadata, jsonContent) {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const body =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(jsonContent) +
        closeDelimiter;
    const blob = new Blob([body], { type: `multipart/related; boundary="${boundary}"` });
    return blob;
}

async function readDriveFile(fileId) {
    const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return resp.json();
}

async function writeDriveFile(fileId, data) {
    const metadata = { name: DRIVE_FILE_NAME };
    const body = buildMultipartBody(metadata, data);
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
        method: 'PATCH',
        headers: { 'Content-Type': body.type },
        body,
    });
}

async function ensureDriveFile() {
    setDriveStatus('syncing');
    let fileId = await findDriveFileId();
    if (!fileId) {
        fileId = await createDriveFile({});
    }
    setDriveStatus('idle');
    return fileId;
}

async function syncFromDrive() {
    if (!state.currentUser) return;
    try {
        setDriveStatus('syncing');
        const fileId = await ensureDriveFile();
        const remote = await readDriveFile(fileId);
        if (remote && typeof remote === 'object') {
            setMessages(remote);
        } else if (Object.keys(state.messages || {}).length) {
            // Remote empty but local has data; push it up.
            await writeDriveFile(fileId, state.messages);
        }
    } catch (err) {
        console.warn('Failed to sync from Drive', err);
        setDriveStatus('error');
    } finally {
        setDriveStatus('idle');
    }
}

async function syncToDrive() {
    if (!state.currentUser) return;
    try {
        setDriveStatus('syncing');
        const fileId = await ensureDriveFile();
        await writeDriveFile(fileId, state.messages || {});
    } catch (err) {
        console.warn('Failed to sync to Drive', err);
        setDriveStatus('error');
        throw err;
    } finally {
        setDriveStatus('idle');
    }
}

async function bootstrapDriveSync() {
    if (!state.currentUser) return;
    try {
        await googleReadyPromise();
        await syncFromDrive();
    } catch (err) {
        console.warn('Drive bootstrap failed', err);
        setDriveStatus('error');
    }
}

main();
