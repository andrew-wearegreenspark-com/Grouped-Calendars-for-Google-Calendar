"use strict";

document.getElementById("manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("calendar").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://calendar.google.com/" });
});
