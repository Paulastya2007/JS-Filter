document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("script-list");
  const saveBtn = document.getElementById("save-btn");

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      list.innerHTML = "<li>No active tab found.</li>";
      return;
    }

    // Inject a content script to get all JS sources from the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.scripts).map(s => s.src).filter(Boolean)
    });

    const scripts = results?.[0]?.result || [];
    list.innerHTML = "";

    if (scripts.length === 0) {
      list.innerHTML = "<li>No external JS files found.</li>";
      return;
    }

    // Build list safely (avoid innerHTML with untrusted data)
    scripts.forEach(src => {
      const li = document.createElement("li");

      const span = document.createElement("span");
      span.title = src;                       // full src in title
      span.textContent = src.split("/").pop() || src; // visible filename or full src

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";

      li.appendChild(span);
      li.appendChild(checkbox);
      list.appendChild(li);
    });

    const storageKey = "blocked_" + tab.id;

    // Restore saved state (if any)
    chrome.storage.local.get([storageKey], (res) => {
      if (chrome.runtime.lastError) {
        console.error("Storage get error:", chrome.runtime.lastError);
        return;
      }
      const blocked = res[storageKey] || [];
      // check matching checkboxes
      Array.from(list.querySelectorAll("li")).forEach(li => {
        const title = li.querySelector("span")?.title;
        const cb = li.querySelector("input[type=checkbox]");
        if (title && cb && blocked.includes(title)) cb.checked = true;
      });
      console.log("Restored", storageKey, blocked);
    });

    // Save handler (no alert)
    saveBtn.addEventListener("click", async () => {
      try {
        const blocked = Array.from(list.querySelectorAll("input[type=checkbox]:checked"))
                             .map(cb => cb.closest("li").querySelector("span").title);
        chrome.storage.local.set({ [storageKey]: blocked }, () => {
          if (chrome.runtime.lastError) {
            console.error("Storage set error:", chrome.runtime.lastError);
          } else {
            console.log("Saved", storageKey, blocked);
          }
        });
        chrome.tabs.reload(tab.id);
    } catch (err) {
        console.error("Save handler error:", err);
      }
    });

  } catch (error) {
    console.error("Error:", error);
    list.innerHTML = `<li>Error: ${error.message}</li>`;
  }
});
