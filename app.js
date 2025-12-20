// Basic frontend-only chat with Google login and Google Drive appData storage.

const GOOGLE_CLIENT_ID = '59648450302-sqkk4pdujkt4hrm0uuhq95pq55b4jg2k.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const PEOPLE_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
const DRIVE_FILE_NAME = 'chat_history.json';

const state = {
    currentUser: null,
    peerEmail: null,
    messages: loadMessages(),
    googleReady: null,
    peerProfiles: loadPeerProfiles(),
    drive: {
        accessToken: null,
        expiresAt: null,
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

function loadPeerProfiles() {
    try {
        const raw = localStorage.getItem('chat-peer-profiles');
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.warn('Failed to load peer profiles', err);
        return {};
    }
}

function persistMessages() {
    localStorage.setItem('chat-app-messages', JSON.stringify(state.messages));
}

function persistPeerProfiles() {
    localStorage.setItem('chat-peer-profiles', JSON.stringify(state.peerProfiles));
}

function persistDriveToken(token, expiresInSeconds) {
    const expiresAt = Date.now() + (expiresInSeconds || 3600) * 1000 - 30000; // 30s safety window
    state.drive.accessToken = token;
    state.drive.expiresAt = expiresAt;
    localStorage.setItem('chat-drive-token', token);
    localStorage.setItem('chat-drive-token-exp', String(expiresAt));
}

function restoreDriveToken() {
    try {
        const token = localStorage.getItem('chat-drive-token');
        const expRaw = localStorage.getItem('chat-drive-token-exp');
        if (!token || !expRaw) return;
        const exp = Number(expRaw);
        if (Number.isFinite(exp) && exp > Date.now() + 5000) {
            state.drive.accessToken = token;
            state.drive.expiresAt = exp;
        } else {
            localStorage.removeItem('chat-drive-token');
            localStorage.removeItem('chat-drive-token-exp');
        }
    } catch (err) {
        console.warn('Failed to restore drive token', err);
    }
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
    // Clear peer when user logs out
    if (!user) {
        setPeer(null);
    }
    renderUserCard();
    updateAuthStatus();
    toggleAuthButtons();
    renderMessages();
    renderRecentChats().catch(err => console.warn('Failed to render recent chats', err));
    if (user) {
        localStorage.setItem('chat-app-current-user', JSON.stringify(user));
        // Automatically request Drive permissions when user signs in
        // This ensures messages can be synced across devices
        requestDriveToken()
            .then(token => {
                console.log('Drive token obtained for cross-device sync');
                // Immediately bootstrap sync to load any messages from Drive
                bootstrapDriveSync();
            })
            .catch(err => {
                console.debug('Drive permission not granted (optional):', err.message);
                // It's ok if Drive sync is skipped - local storage still works
            });
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
    // Auth buttons are now handled by Google's signin/signout in the header
}

function initUI() {
    if (els.messageForm) els.messageForm.addEventListener('submit', handleSend);
    if (els.startChatForm) els.startChatForm.addEventListener('submit', handleStartChat);
    els.syncBtn = document.getElementById('sync-drive');
    els.syncBtn?.addEventListener('click', handleSyncClick);
    
    // Back button for mobile
    const backButton = document.getElementById('back-button');
    if (backButton) {
        backButton.addEventListener('click', () => {
            setPeer(null);
        });
    }
    
    toggleAuthButtons();
}

function setPeer(email) {
    state.peerEmail = email;
    els.peerLabel.textContent = email || 'No peer selected';
    // Clear input field when peer is cleared
    if (els.peerEmailInput) {
        els.peerEmailInput.value = email || '';
    }
    renderMessages();
    
    // Show/hide mobile panels
    const isMobile = window.innerWidth <= 900;
    const layout = document.querySelector('.layout');
    const backButton = document.getElementById('back-button');
    
    if (email) {
        localStorage.setItem('chat-app-peer', email);
        if (isMobile && layout) {
            layout.classList.add('show-chat');
            layout.classList.remove('show-peers');
        }
        if (backButton) backButton.style.display = 'block';
        // Fetch peer profile from Google to display full name
        fetchPeerProfileFromGoogle(email)
            .then(profile => {
                if (profile) {
                    els.peerLabel.textContent = profile.name || email;
                    renderRecentChats().catch(err => console.warn('Failed to render recent chats', err));
                }
            })
            .catch(err => console.debug('Failed to fetch peer profile:', err));
    } else {
        localStorage.removeItem('chat-app-peer');
        if (isMobile && layout) {
            layout.classList.remove('show-chat');
            layout.classList.add('show-peers');
        }
        if (backButton) backButton.style.display = 'none';
    }
}

function setMessages(newMessages) {
    state.messages = newMessages || {};
    persistMessages();
    renderMessages();
    renderRecentChats().catch(err => console.warn('Failed to render recent chats', err));
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
        fromName: state.currentUser.name,
        fromPicture: state.currentUser.picture,
    });
    persistMessages();
    renderMessages();
    renderRecentChats().catch(err => console.warn('Failed to render recent chats', err));
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
    els.startChatForm.reset();
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
    // Auto-sync from Drive after sign-in (will hide sync button on success)
    setTimeout(() => {
        bootstrapDriveSync()
            .then(() => hideSyncButton())
            .catch(err => {
                console.warn('Auto-sync failed:', err);
                showSyncButton(); // Show button only if sync fails
            });
    }, 500);
}

// Make callback globally accessible for HTML API
window.handleCredentialResponse = handleCredentialResponse;

function initGoogle() {
    // Google sign-in is now handled by the shared header (HarithShell)
    // Just ensure our callback is available and handle One Tap if needed

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
    // Clear shared user key so header also logs out
    localStorage.removeItem('harith_google_user');
    setCurrentUser(null);
    state.drive = { accessToken: null, expiresAt: null, fileId: null, status: 'idle' };
    localStorage.removeItem('chat-drive-token');
    localStorage.removeItem('chat-drive-token-exp');
    hideSyncButton();
}

async function fetchPeerProfileFromGoogle(email) {
    // Check cache first
    if (state.peerProfiles[email]) {
        return state.peerProfiles[email];
    }

    // Extract name from email as fallback
    const namePart = email.split('@')[0];
    const displayName = namePart
        .replace(/[0-9]+/g, '')
        .split(/[._-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        || email;
    const firstName = displayName.split(' ')[0];

    const profile = {
        email: email,
        name: firstName,
        picture: ''
    };

    // Use People API to find contact profile
    if (state.drive.accessToken) {
        try {
            const response = await fetch(
                `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(email)}&readMask=names,photos,emailAddresses`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${state.drive.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                const results = data.results || [];
                if (results.length > 0) {
                    const person = results[0].person;
                    const fullName = person.names?.[0]?.displayName || email;

                    let photoUrl = '';
                    if (person.photos && person.photos.length > 0) {
                        photoUrl = person.photos[0].url || '';
                    }

                    profile.name = fullName;
                    if (photoUrl) {
                        profile.picture = photoUrl;
                    }
                }
            }
        } catch (err) {
            console.debug('People API search failed:', err.message);
        }
    }

    // Cache it
    state.peerProfiles[email] = profile;
    persistPeerProfiles();
    return profile;
}

function hideSyncButton() {
    if (els.syncBtn) {
        els.syncBtn.hidden = true;
    }
}

async function handleSyncClick() {
    if (!state.currentUser) return;
    try {
        await bootstrapDriveSync();
        hideSyncButton();
    } catch (err) {
        console.error('Sync failed:', err);
        const msg = err?.error || err?.message || 'Unknown error';
        alert(`Drive sync failed: ${msg}\n\nPlease check:\n1. Drive API is enabled\n2. JavaScript origin (https://harithkavish.github.io) is authorized\n3. OAuth consent screen is complete`);
    }
}

function restoreLastSession() {
    try {
        // Check shared Google user first (from landing page or shared header)
        const sharedRaw = localStorage.getItem('harith_google_user');
        if (sharedRaw) {
            const sharedUser = JSON.parse(sharedRaw);
            setCurrentUser({
                email: sharedUser.email,
                name: sharedUser.name,
                picture: sharedUser.picture,
                provider: 'google'
            });
        } else {
            // Fall back to chat-app-specific user
            const raw = localStorage.getItem('chat-app-current-user');
            if (raw) {
                const parsed = JSON.parse(raw);
                setCurrentUser(parsed);
            }
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

// Watch for sign-in from shared header
window.addEventListener('storage', (event) => {
    if (event.key === 'harith_google_user') {
        if (event.newValue) {
            // User signed in from another tab/page
            try {
                const sharedUser = JSON.parse(event.newValue);
                setCurrentUser({
                    email: sharedUser.email,
                    name: sharedUser.name,
                    picture: sharedUser.picture,
                    provider: 'google'
                });
            } catch (err) {
                console.warn('Failed to sync user from shared storage:', err);
            }
        } else {
            // User signed out from another tab/page (key was deleted)
            setCurrentUser(null);
        }
    }
});

// Listen for logout event from header (same-page logout)
window.addEventListener('harith-logout', () => {
    setCurrentUser(null);
});

function main() {
    // Restore session BEFORE initializing UI to prevent "Not signed in" flash
    restoreLastSession();
    restoreDriveToken();

    // Debug log
    const sharedUser = localStorage.getItem('harith_google_user');
    console.log('Shared user on restore:', sharedUser ? 'Found' : 'Not found');

    initUI();

    // Small delay for Drive token management and Google init
    setTimeout(() => {
        if (state.currentUser) {
            // If we have a cached token, try silent sync
            if (state.drive.accessToken) {
                bootstrapDriveSync();
            } else {
                // Attempt to request Drive access on page load (with user gesture fallback)
                showSyncButton();
                setTimeout(() => {
                    requestDriveToken()
                        .then(() => bootstrapDriveSync())
                        .then(() => hideSyncButton())
                        .catch(err => console.warn('Drive access popup blocked or denied:', err));
                }, 1000);
            }
        }
        initGoogle();
        renderMessages();
        // Refresh recent chats after UI is fully ready
        renderRecentChats().catch(err => console.warn('Failed to render recent chats:', err));
    }, 100);
}

// -------- Google Drive appData helpers --------
let tokenClient;

function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: `${DRIVE_SCOPE} ${PEOPLE_SCOPE}`,
        include_granted_scopes: true,
        prompt: 'consent',
        callback: (resp) => {
            if (resp.error) {
                tokenRequestReject && tokenRequestReject(resp);
            } else {
                persistDriveToken(resp.access_token, resp.expires_in);
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
        tokenRequestReject = (err) => {
            console.error('Drive token request failed:', err);
            reject(err);
        };
        try {
            ensureTokenClient().requestAccessToken({
                prompt: 'consent',
                include_granted_scopes: true,
            });
        } catch (err) {
            console.error('Failed to request token:', err);
            reject(err);
        }
    });
}

async function getAccessToken() {
    if (state.drive.accessToken && state.drive.expiresAt && state.drive.expiresAt > Date.now() + 5000) {
        return state.drive.accessToken;
    }
    await googleReadyPromise();
    setDriveStatus('auth');
    const token = await requestDriveToken();
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

function getRecentChats() {
    if (!state.currentUser) return [];

    const recentChatsMap = {};

    // Iterate through all messages
    for (const [key, chatMessages] of Object.entries(state.messages || {})) {
        const parts = key.split('::');
        if (parts.length !== 2) continue;

        const email1 = parts[0];
        const email2 = parts[1];
        const peerEmail = email1 === state.currentUser.email.toLowerCase() ? email2 : email1;

        if (peerEmail && Array.isArray(chatMessages) && chatMessages.length > 0) {
            const lastMessage = chatMessages[chatMessages.length - 1];
            const timestamp = lastMessage?.timestamp || 0;

            // Find the peer's profile info by looking for a message from the peer
            let peerName = peerEmail;
            let peerPicture = '';

            // First check message history
            for (const msg of chatMessages) {
                if (msg.from === peerEmail && msg.fromName) {
                    peerName = msg.fromName;
                    peerPicture = msg.fromPicture || '';
                    break;
                }
            }

            // Then check cached profiles
            if (state.peerProfiles[peerEmail]) {
                peerName = state.peerProfiles[peerEmail].name;
                peerPicture = state.peerProfiles[peerEmail].picture;
            }

            // Fallback: extract name from email (part before @)
            if (peerName === peerEmail) {
                const namePart = peerEmail.split('@')[0];
                // Convert format like "harithkavish97" to "Harith Kavish"
                peerName = namePart
                    .replace(/[0-9]+/g, '') // Remove numbers
                    .replace(/([a-z])([A-Z])/g, '$1 $2') // Handle camelCase
                    .split(/[._-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') // Capitalize each word
                    || peerEmail;
            }

            if (!recentChatsMap[peerEmail] || recentChatsMap[peerEmail].timestamp < timestamp) {
                recentChatsMap[peerEmail] = {
                    email: peerEmail,
                    timestamp: timestamp,
                    name: peerName,
                    picture: peerPicture
                };
            }
        }
    }

    // Sort by most recent first
    return Object.values(recentChatsMap).sort((a, b) => b.timestamp - a.timestamp);
}

async function renderRecentChats() {
    const container = document.getElementById('recent-chats');
    if (!container) return;

    const recentChats = getRecentChats();

    if (recentChats.length === 0) {
        container.innerHTML = '<div class="empty">No recent chats</div>';
        return;
    }

    // Try to fetch missing profiles from Google
    for (const chat of recentChats) {
        if (!chat.picture && state.drive.accessToken) {
            const profile = await fetchPeerProfileFromGoogle(chat.email);
            if (profile) {
                chat.name = profile.name;
                chat.picture = profile.picture;
            }
        }
    }

    container.innerHTML = recentChats.map(chat => `
        <div class="recent-chat-item" data-email="${chat.email}">
            <img 
                src="${chat.picture || 'https://www.gravatar.com/avatar/?d=mp'}" 
                alt="${chat.name}" 
                class="recent-chat-item__avatar"
                loading="lazy"
            />
            <div class="recent-chat-item__info">
                <div class="recent-chat-item__name">${chat.name || chat.email}</div>
                <div class="recent-chat-item__email">${chat.email}</div>
            </div>
        </div>
    `).join('');

    // Add click handlers to recent chat items
    container.querySelectorAll('.recent-chat-item').forEach(item => {
        item.addEventListener('click', () => {
            const email = item.dataset.email;
            if (email) {
                els.peerEmailInput.value = email;
                setPeer(email);
            }
        });
    });
}

// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
