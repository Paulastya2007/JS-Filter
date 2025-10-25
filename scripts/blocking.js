// scripts/blocking.js
// Attach to checkboxes created by your script.js and manage session-scoped blocked list.
// - Stores blocked script URLs in chrome.storage.session (fallback to local).
// - Injects a small script into the active tab to remove matching <script> nodes immediately.

(() => {
  // Helpers to use session storage when available, otherwise fallback to local storage.
  const storageGet = (key) => {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(key, (res) => resolve(res || {}));
      } else {
        chrome.storage.local.get(key, (res) => resolve(res || {}));
      }
    });
  };

  const storageSet = (obj) => {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.set(obj, () => resolve());
      } else {
        chrome.storage.local.set(obj, () => resolve());
      }
    });
  };

  const storageRemoveKey = (key) => {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.remove(key, () => resolve());
      } else {
        chrome.storage.local.remove(key, () => resolve());
      }
    });
  };

  // Normalize to absolute URL (safely)
  const toAbsolute = (rawUrl, base) => {
    try {
      return new URL(rawUrl, base).href;
    } catch (e) {
      return rawUrl || "";
    }
  };

  // Remove script nodes with matching full URLs inside the page (injected into tab)
  const removeScriptsInTab = async (tabId, urls = []) => {
    if (!tabId || !urls || urls.length === 0) return;
    try {
      // Use chrome.scripting.executeScript to run removal inside the page
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (blockedUrls) => {
          // run inside page context
          try {
            const abs = (u) => {
              try {
                return new URL(u, location.href).href;
              } catch (e) {
                return u || "";
              }
            };
            const blockedSet = new Set(blockedUrls.map(abs));
            // Remove existing <script> tags that exactly match blocked URLs
            const scripts = Array.from(document.getElementsByTagName("script"));
            scripts.forEach(s => {
              if (s.src && blockedSet.has(abs(s.src))) {
                s.remove();
              }
            });
            // Also observe newly inserted script nodes and remove them quickly
            const obs = new MutationObserver((mutations) => {
              for (const m of mutations) {
                for (const n of m.addedNodes) {
                  if (n.tagName && n.tagName.toLowerCase() === 'script') {
                    const src = n.src || "";
                    if (src && blockedSet.has(abs(src))) {
                      n.remove();
                    }
                  }
                }
              }
            });
            obs.observe(document.documentElement || document, { childList: true, subtree: true });
          } catch (e) {
            // silent: don't break page
          }
        },
        args: [urls],
      });
    } catch (err) {
      // may fail on some special pages (extensions pages, etc.) — ignore
      console.warn("removeScriptsInTab error:", err);
    }
  };

  // Key under which we store the blocked map
  const STORAGE_KEY = "blocked_scripts";

  // Read the currently blocked map (object where keys are absolute urls -> true)
  const getBlockedMap = async () => {
    const res = await storageGet(STORAGE_KEY);
    return res[STORAGE_KEY] || {};
  };

  // Set the blocked map
  const setBlockedMap = async (map) => {
    await storageSet({ [STORAGE_KEY]: map });
  };

  // Update a single key (urlKey) to checked/un-checked
  const updateBlockedEntry = async (urlKey, shouldBlock) => {
    const map = await getBlockedMap();
    if (shouldBlock) map[urlKey] = true;
    else delete map[urlKey];
    await setBlockedMap(map);
    return map;
  };

  // Given a checkbox input element (from your popup), derive the full absolute URL key.
  // Your script.js uses: <span title="${src}">filename</span> and <input type="checkbox" />
  // So we look for the preceding span's title attribute as the full src.
  const getUrlFromCheckbox = async (chk) => {
    if (!chk) return "";
    // find the closest LI or parent
    const li = chk.closest("li");
    if (!li) return "";
    // prefer span[title] inside li
    const span = li.querySelector("span[title]") || li.querySelector("strong[title]") || li.querySelector(".meta strong[title]");
    const raw = span ? span.getAttribute("title") : "";
    // If raw is empty but there is a src div, try that
    if (!raw) {
      const srcDiv = li.querySelector(".src");
      if (srcDiv) raw = srcDiv.textContent || srcDiv.innerText || "";
    }
    // Need a base to resolve relative URLs; query active tab for base
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const base = (tabs && tabs[0] && tabs[0].url) ? tabs[0].url : location.href;
    const abs = toAbsolute(raw, base);
    return abs;
  };

  // Event handler for checkbox changes (delegated)
  const onCheckboxChange = async (e) => {
    const target = e.target;
    if (!target || target.type !== "checkbox") return;
    // derive absolute url key
    const urlKey = await getUrlFromCheckbox(target);
    if (!urlKey) {
      // nothing to block (maybe it's an inline script or malformed)
      // If inline, the title could be empty — we don't attempt to block inline here.
      return;
    }

    // persist the change (session-scoped if available)
    const newMap = await updateBlockedEntry(urlKey, target.checked);

    // try to remove the script nodes now from the active tab (no reload)
    // get active tab id
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && tab.id != null) {
      if (target.checked) {
        // remove matching scripts immediately
        await removeScriptsInTab(tab.id, [urlKey]);
      } else {
        // unchecked: we removed the block from storage; to load the script again the page usually needs reload.
        // Optionally we could attempt to re-insert the script tag, but safer is to ask user to refresh.
        // For UX, we do nothing here (user can use Refresh button).
      }
    }
  };

  // Initialize: attach event delegation and also attach to existing checkboxes (in some browsers delegation is enough)
  const init = () => {
    const list = document.getElementById("script-list");
    if (!list) return;

    // Delegated listener for change events on inputs inside the list
    list.addEventListener("change", (e) => {
      // run and don't await (handler uses chrome APIs)
      onCheckboxChange(e).catch(err => console.error("checkbox handler err", err));
    });

    // If checkboxes already exist, set their checked state based on the session blocked map
    (async () => {
      try {
        const blocked = await getBlockedMap();
        // iterate inputs and mark checked if present in blocked
        const inputs = Array.from(list.querySelectorAll('input[type="checkbox"]'));
        if (inputs.length === 0) return;

        // get active tab base for resolving relative URLs
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const base = tabs && tabs[0] && tabs[0].url ? tabs[0].url : location.href;

        inputs.forEach(async (inp) => {
          // derive url from sibling span title or .src
          const li = inp.closest('li');
          let raw = "";
          const span = li && li.querySelector("span[title]") || li && li.querySelector("strong[title]");
          if (span) raw = span.getAttribute("title") || "";
          if (!raw) {
            const s = li && li.querySelector(".src");
            if (s) raw = s.textContent || s.innerText || "";
          }
          const abs = toAbsolute(raw, base);
          if (abs && blocked[abs]) inp.checked = true;
        });
      } catch (e) {
        console.warn("init check populate error", e);
      }
    })();
  };

  // Run init once DOM is ready (popup DOM)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose small helper for debugging if needed
  window.__ext_blocking_helpers = {
    getBlockedMap,
    setBlockedMap,
    storageGet,
    storageSet
  };

})();
