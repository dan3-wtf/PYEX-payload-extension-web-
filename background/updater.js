/**
 * LUHUT BINSHAR - Background Updater
 * Service worker for payload updates
 */

// Check for updates on install
chrome.runtime.onInstalled.addListener(async () => {
    console.log('PYEX installed');

    // Set alarm for periodic updates (every 24 hours)
    if (chrome.alarms) {
        chrome.alarms.create('checkUpdates', { periodInMinutes: 1440 });
    }

    // Initial update check
    await checkForUpdates();
});

// Handle alarm (with safety check)
if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name === 'checkUpdates') {
            await checkForUpdates();
        }
    });
}

// Check for payload updates from GitHub
async function checkForUpdates() {
    try {
        const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/hyla001/luhut-binshar/main';

        // Fetch version info
        const response = await fetch(`${GITHUB_RAW_BASE}/version.json`);
        if (!response.ok) return;

        const remoteVersion = await response.json();

        // Get local version from storage
        const result = await chrome.storage.local.get('payloadVersion');
        const localVersion = result.payloadVersion;

        // If version changed, notify popup to refresh
        if (!localVersion || localVersion !== remoteVersion.version) {
            console.log('New payloads available:', remoteVersion.version);

            // Fetch all payloads
            await updatePayloadsCache(GITHUB_RAW_BASE);

            // Update stored version
            await chrome.storage.local.set({ payloadVersion: remoteVersion.version });
        }

        // === SYNC FINGERPRINTS DATABASE ===
        await syncFingerprintsDatabase(GITHUB_RAW_BASE);

    } catch (error) {
        console.warn('Update check failed:', error);
    }
}

// Sync fingerprints database for tech detection
async function syncFingerprintsDatabase(baseUrl) {
    try {
        // Check if we need to update fingerprints
        const stored = await chrome.storage.local.get(['fingerprintsVersion', 'cachedFingerprints']);
        const lastSync = stored.fingerprintsVersion || 0;
        const now = Date.now();

        // Sync every 24 hours
        if (now - lastSync < 86400000 && stored.cachedFingerprints) {
            return;
        }

        console.log('[Tech Detector] Syncing fingerprints database...');

        // Try to fetch from GitHub
        const response = await fetch(`${baseUrl}/fingerprints/technologies.json`);
        if (response.ok) {
            const fingerprints = await response.json();
            await chrome.storage.local.set({
                cachedFingerprints: fingerprints,
                fingerprintsVersion: now
            });
            console.log('[Tech Detector] Fingerprints synced from GitHub');
            return;
        }

        // If GitHub fails, use local extension file
        console.log('[Tech Detector] Using local fingerprints file');

    } catch (error) {
        console.warn('[Tech Detector] Fingerprints sync failed:', error);
    }
}

async function updatePayloadsCache(baseUrl) {
    const categories = ['xss', 'sqli', 'ssrf', 'lfi', 'rfi', 'cmdi', 'ssti', 'open_redirect', 'csrf', '2fa_bypass', 'waf_bypass'];
    const allPayloads = [];

    for (const category of categories) {
        try {
            const response = await fetch(`${baseUrl}/payloads/${category}.json`);
            if (response.ok) {
                const data = await response.json();
                if (data.payloads) {
                    allPayloads.push(...data.payloads);
                }
            }
        } catch (error) {
            console.warn(`Failed to fetch ${category}:`, error);
        }
    }

    // Store in chrome.storage for quick access
    if (allPayloads.length > 0) {
        await chrome.storage.local.set({
            cachedPayloads: allPayloads,
            lastUpdate: new Date().toISOString()
        });
        console.log(`Cached ${allPayloads.length} payloads`);
    }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkUpdates') {
        checkForUpdates().then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.action === 'getCachedPayloads') {
        chrome.storage.local.get('cachedPayloads').then(result => {
            sendResponse({ payloads: result.cachedPayloads || [] });
        });
        return true;
    }

    // Get captured headers for tech detection
    if (message.action === 'getTechHeaders') {
        const tabId = message.tabId;
        sendResponse({ headers: capturedHeaders[tabId] || {} });
        return true;
    }

    // Fetch framework versions from chunk files
    if (message.action === 'fetchTechVersions') {
        fetchFrameworkVersions(message.url, message.scripts).then(versions => {
            sendResponse({ versions });
        }).catch(e => {
            console.warn('Failed to fetch versions:', e);
            sendResponse({ versions: {} });
        });
        return true;
    }
});

// Fetch and parse chunk files for version extraction
async function fetchFrameworkVersions(pageUrl, scriptUrls) {
    const versions = {};

    try {
        // Find Next.js chunk files
        const nextChunks = scriptUrls.filter(s => s.includes('/_next/'));

        // Try to fetch the main webpack chunk to find Next.js version
        for (const chunkUrl of nextChunks.slice(0, 3)) { // Limit to first 3 chunks
            try {
                const response = await fetch(chunkUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'text/javascript' }
                });
                if (!response.ok) continue;

                const text = await response.text();

                // Look for Next.js version patterns in the chunk
                const versionPatterns = [
                    // /*! next@14.0.3 */
                    /\/\*!\s*next@(\d+\.\d+\.\d+)/i,
                    // "next":"14.0.3"
                    /"next"\s*:\s*"(\d+\.\d+\.\d+)"/i,
                    // version:"14.0.3"
                    /version\s*:\s*["'](\d+\.\d+\.\d+)["']/i,
                    // Next.js 14.0.3
                    /Next\.js\s+v?(\d+\.\d+\.\d+)/i,
                    // __NEXT_VERSION = "14.0.3"
                    /__NEXT_VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/i
                ];

                for (const pattern of versionPatterns) {
                    const match = text.match(pattern);
                    if (match) {
                        versions.nextjs = match[1];
                        console.log('[Tech Detector] Found Next.js version:', match[1]);
                        break;
                    }
                }

                // Also look for React version
                const reactMatch = text.match(/react@(\d+\.\d+\.\d+)/i) ||
                    text.match(/"react"\s*:\s*"(\d+\.\d+\.\d+)"/i);
                if (reactMatch && !versions.react) {
                    versions.react = reactMatch[1];
                }

                if (versions.nextjs) break; // Found what we need

            } catch (e) {
                // Continue to next chunk
            }
        }

        // Try to fetch package.json if accessible (rare but possible)
        try {
            const pkgUrl = new URL('/package.json', pageUrl).href;
            const pkgResponse = await fetch(pkgUrl);
            if (pkgResponse.ok) {
                const pkg = await pkgResponse.json();
                if (pkg.dependencies?.next) {
                    const vMatch = pkg.dependencies.next.match(/(\d+\.\d+\.\d+)/);
                    if (vMatch) versions.nextjs = vMatch[1];
                }
                if (pkg.dependencies?.react) {
                    const vMatch = pkg.dependencies.react.match(/(\d+\.\d+\.\d+)/);
                    if (vMatch) versions.react = vMatch[1];
                }
            }
        } catch (e) {
            // package.json not accessible, which is normal
        }

    } catch (e) {
        console.warn('[Tech Detector] Version fetch error:', e);
    }

    return versions;
}

// ===== TECH DETECTOR - HTTP HEADER INTERCEPTION =====
const capturedHeaders = {};

// Listen for response headers on all URLs
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        // Only capture main frame and document requests
        if (details.type !== 'main_frame') return;

        const tabId = details.tabId;
        if (tabId < 0) return;

        const headers = {};
        const techIndicators = {};

        // Process response headers
        details.responseHeaders.forEach(header => {
            const name = header.name.toLowerCase();
            const value = header.value;

            headers[name] = value;

            // Extract technology indicators from headers
            switch (name) {
                case 'server':
                    // Parse server header (e.g., "nginx/1.18.0", "Apache/2.4.41")
                    techIndicators.server = value;
                    const serverMatch = value.match(/^([a-zA-Z-]+)\/?(\d+[\d.]*)?/);
                    if (serverMatch) {
                        techIndicators.serverName = serverMatch[1];
                        techIndicators.serverVersion = serverMatch[2] || null;
                    }
                    break;

                case 'x-powered-by':
                    // Parse X-Powered-By (e.g., "PHP/8.1.0", "Express", "Next.js 14.0.3")
                    techIndicators.poweredBy = value;
                    const poweredMatch = value.match(/^([a-zA-Z.-]+)\s*\/?v?(\d+[\d.]*)?/i);
                    if (poweredMatch) {
                        techIndicators.poweredByName = poweredMatch[1];
                        techIndicators.poweredByVersion = poweredMatch[2] || null;
                    }
                    break;

                case 'x-aspnet-version':
                    techIndicators.aspNet = value;
                    break;

                case 'x-aspnetmvc-version':
                    techIndicators.aspNetMvc = value;
                    break;

                case 'x-drupal-cache':
                case 'x-drupal-dynamic-cache':
                    techIndicators.drupal = true;
                    break;

                case 'x-generator':
                    techIndicators.generator = value;
                    break;

                case 'x-shopify-stage':
                    techIndicators.shopify = true;
                    break;

                case 'x-wix-request-id':
                    techIndicators.wix = true;
                    break;

                case 'x-amz-cf-id':
                case 'x-amz-cf-pop':
                    techIndicators.cloudfront = true;
                    break;

                case 'cf-ray':
                    techIndicators.cloudflare = true;
                    break;

                case 'x-vercel-id':
                case 'x-vercel-cache':
                    techIndicators.vercel = true;
                    break;

                case 'x-nf-request-id':
                    techIndicators.netlify = true;
                    break;

                case 'x-firebase-hosting':
                    techIndicators.firebase = true;
                    break;

                case 'via':
                    if (value.includes('cloudfront')) techIndicators.cloudfront = true;
                    if (value.includes('varnish')) techIndicators.varnish = true;
                    break;

                case 'x-cache':
                    if (value.includes('cloudfront')) techIndicators.cloudfront = true;
                    break;

                case 'set-cookie':
                    // Check for framework cookies
                    if (value.includes('PHPSESSID')) techIndicators.php = true;
                    if (value.includes('JSESSIONID')) techIndicators.java = true;
                    if (value.includes('ASP.NET')) techIndicators.aspNet = true;
                    if (value.includes('laravel')) techIndicators.laravel = true;
                    if (value.includes('__next')) techIndicators.nextjs = true;
                    break;
            }
        });

        // Store captured data
        capturedHeaders[tabId] = {
            headers,
            techIndicators,
            url: details.url,
            timestamp: Date.now()
        };

        console.log('[Tech Detector] Captured headers for tab', tabId, techIndicators);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// Clean up old captured headers when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    delete capturedHeaders[tabId];
});

// Clean up when tab navigates to new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        delete capturedHeaders[tabId];
    }
});

// ===== REQUEST INTERCEPTOR =====
let interceptedRequests = [];
let isIntercepting = false;

// Load initial state for interceptor
chrome.storage.local.get(['isIntercepting'], (result) => {
    if (result.isIntercepting !== undefined) {
        isIntercepting = result.isIntercepting;
        console.log('[Background] Restored isIntercepting state:', isIntercepting);
    }
});

// Handle intercept messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'startIntercept') {
        isIntercepting = true;
        interceptedRequests = [];
        chrome.storage.local.set({ isIntercepting: true, interceptedRequests: [] });
        console.log('[Interceptor] Started');
        sendResponse({ success: true });
    } else if (message.type === 'stopIntercept') {
        isIntercepting = false;
        chrome.storage.local.set({ isIntercepting: false });
        console.log('[Interceptor] Stopped');
        sendResponse({ success: true });
    } else if (message.type === 'getInterceptedRequests') {
        sendResponse({ requests: interceptedRequests });
    } else if (message.type === 'getInterceptorStatus') {
        sendResponse({ isIntercepting });
    } else if (message.type === 'clearInterceptedRequests') {
        interceptedRequests = [];
        chrome.storage.local.set({ interceptedRequests: [] });
        sendResponse({ success: true });
    }
    return true; // Keep channel open for async response
});

// Capture requests when intercepting
chrome.webRequest.onCompleted.addListener(
    (details) => {
        if (!isIntercepting) return;

        // Only capture main requests, not extensions or internal
        if (details.url.startsWith('chrome-extension://')) return;
        if (details.url.startsWith('chrome://')) return;

        interceptedRequests.unshift({
            url: details.url,
            method: details.method,
            statusCode: details.statusCode,
            type: details.type,
            timeStamp: details.timeStamp,
            tabId: details.tabId
        });

        // Keep only last 100 requests
        if (interceptedRequests.length > 100) {
            interceptedRequests = interceptedRequests.slice(0, 100);
        }
    },
    { urls: ["<all_urls>"] }
);

// Also capture failed requests
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        if (!isIntercepting) return;
        if (details.url.startsWith('chrome-extension://')) return;

        interceptedRequests.unshift({
            url: details.url,
            method: details.method,
            statusCode: 0,
            type: details.type,
            timeStamp: details.timeStamp,
            error: details.error,
            tabId: details.tabId
        });

        if (interceptedRequests.length > 100) {
            interceptedRequests = interceptedRequests.slice(0, 100);
        }
    },
    { urls: ["<all_urls>"] }
);

// ===== PERSISTENT STORAGE =====
// Save discovered data to storage for persistence across popup closes

// Load persisted data on startup
chrome.storage.local.get(['discoveredEndpoints', 'discoveredSubdomains', 'interceptedRequests'], (result) => {
    if (result.discoveredEndpoints) {
        console.log('[Background] Loaded persisted endpoints:', result.discoveredEndpoints.length);
    }
    if (result.discoveredSubdomains) {
        console.log('[Background] Loaded persisted subdomains:', result.discoveredSubdomains.length);
    }
    if (result.interceptedRequests) {
        interceptedRequests = result.interceptedRequests;
        console.log('[Background] Loaded persisted requests:', interceptedRequests.length);
    }
});

// Message handler for saving data
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'saveDiscoveredData') {
        const { endpoints, subdomains } = message.data;
        chrome.storage.local.set({
            discoveredEndpoints: endpoints,
            discoveredSubdomains: subdomains
        }, () => {
            console.log('[Background] Saved discovered data to storage');
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'loadDiscoveredData') {
        chrome.storage.local.get(['discoveredEndpoints', 'discoveredSubdomains'], (result) => {
            sendResponse({
                endpoints: result.discoveredEndpoints || { apis: [], paths: [], jsFiles: [] },
                subdomains: result.discoveredSubdomains || []
            });
        });
        return true;
    }

    // Wayback Machine fetch (bypasses CORS from popup)
    if (message.type === 'fetchWayback') {
        const { domain } = message;
        const waybackUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&fl=original&collapse=urlkey`;

        fetch(waybackUrl)
            .then(res => res.json())
            .then(data => {
                sendResponse({ success: true, data });
            })
            .catch(err => {
                console.error('[Background] Wayback fetch failed:', err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    // CVE lookup via circl.lu API (bypasses CORS)
    if (message.type === 'fetchCVE') {
        const { techName, version } = message;
        const searchTerm = encodeURIComponent(techName.toLowerCase());
        const cveUrl = `https://cve.circl.lu/api/search/${searchTerm}`;

        fetch(cveUrl)
            .then(res => res.json())
            .then(data => {
                // Filter by version if provided
                let results = data || [];
                if (version && Array.isArray(results)) {
                    results = results.filter(cve =>
                        cve.summary?.toLowerCase().includes(version.toLowerCase()) ||
                        cve.vulnerable_configuration?.some(cfg => cfg.includes(version))
                    );
                }
                // Limit results
                sendResponse({ success: true, cves: results.slice(0, 10) });
            })
            .catch(err => {
                console.error('[Background] CVE fetch failed:', err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    // Fetch HTTP headers for security analysis
    if (message.type === 'fetchHeaders') {
        const { url } = message;
        fetch(url, { method: 'HEAD' })
            .then(res => {
                const headers = {};
                res.headers.forEach((value, key) => {
                    headers[key.toLowerCase()] = value;
                });
                sendResponse({ success: true, headers });
            })
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
});
// Periodically save intercepted requests (every 10 seconds if active)
setInterval(() => {
    if (isIntercepting && interceptedRequests.length > 0) {
        chrome.storage.local.set({ interceptedRequests }, () => {
            console.log('[Background] Auto-saved intercepted requests');
        });
    }
}, 10000);

// Keep service worker alive (Chrome MV3 limitation workaround)
const KEEP_ALIVE_INTERVAL = 20000; // 20 seconds
setInterval(() => {
    console.log('[Background] Service worker heartbeat');
}, KEEP_ALIVE_INTERVAL);

console.log('[Background] PYEX Background Service initialized');
