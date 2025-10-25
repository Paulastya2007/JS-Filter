document.addEventListener("DOMContentLoaded", async () => {
    const list = document.getElementById("script-list");
    const refreshBtn = document.getElementById("refresh-btn");

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Inject a content script to get all JS sources from the page
    chrome.scripting.executeScript(
        {
            target: { tabId: tab.id },
            func: () => Array.from(document.scripts).map(s => s.src).filter(Boolean)
        },
        (results) => {
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
        }
    );

    refreshBtn.addEventListener("click", () => {
        chrome.tabs.reload(tab.id);
    });
});
