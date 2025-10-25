document.addEventListener("DOMContentLoaded", async () => {
    const list = document.getElementById("script-list");
    const refreshBtn = document.getElementById("refresh-btn");

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

        scripts.forEach(src => {
            const li = document.createElement("li");
            li.innerHTML = `
                <span title="${src}">${src.split("/").pop()}</span>
                <input type="checkbox" />
            `;
            list.appendChild(li);
        });

        refreshBtn.addEventListener("click", () => {
            chrome.tabs.reload(tab.id);
        });

    } catch (error) {
        console.error("Error:", error);
        list.innerHTML = `<li>Error: ${error.message}</li>`;
    }
});