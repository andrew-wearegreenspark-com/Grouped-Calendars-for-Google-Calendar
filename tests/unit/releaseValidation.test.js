"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.strictEqual(manifest.manifest_version, 3);
assert.strictEqual(manifest.version, "1.0.1");
assert.deepStrictEqual(manifest.permissions, ["storage"]);
assert.deepStrictEqual(manifest.host_permissions, ["https://calendar.google.com/*"]);

// Every manifest resource must exist before the production archive is built.
const manifestResources = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((entry) => [...entry.css, ...entry.js])
];
manifestResources.forEach((resource) => {
  assert.ok(fs.existsSync(path.join(root, resource)), `Missing manifest resource: ${resource}`);
});

// Prevent prototype calendar labels or personal identifiers from returning to
// any file shipped in the extension package.
const packagedText = Array.from(new Set(manifestResources.filter((resource) => (
  /\.(js|json|html|css)$/.test(resource)
)))).map((resource) => fs.readFileSync(path.join(root, resource), "utf8")).join("\n").toLocaleLowerCase();
assert.ok(!packagedText.includes("initial_assignment_names"), "Packaged source contains a name-based assignment map");
assert.ok(!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(packagedText), "Packaged source contains an email address");

// PNG width and height are stored in the first IHDR chunk at bytes 16 and 20.
for (const size of [16, 32, 48, 128]) {
  const icon = fs.readFileSync(path.join(root, "assets", "icons", `icon-${size}.png`));
  assert.strictEqual(icon.readUInt32BE(16), size, `icon-${size}.png has the wrong width`);
  assert.strictEqual(icon.readUInt32BE(20), size, `icon-${size}.png has the wrong height`);
  assert.strictEqual(icon[25], 6, `icon-${size}.png must be an RGBA image`);
}

// Store policies require executable code to remain inside the package. These
// checks catch common remote-code and telemetry additions before packaging.
const executableFiles = manifestResources
  .filter((resource) => resource.endsWith(".js"))
  .map((resource) => path.join(root, resource));
const forbiddenPatterns = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\s*\(/,
  /https?:\/\//
];
for (const file of new Set(executableFiles)) {
  const source = fs.readFileSync(file, "utf8");
  // The only literal URL opens Google Calendar in a user-visible tab; remove
  // that known navigation target before checking for network endpoints.
  const inspectedSource = source.replaceAll("https://calendar.google.com/", "");
  forbiddenPatterns.forEach((pattern) => {
    assert.ok(!pattern.test(inspectedSource), `${path.relative(root, file)} matched forbidden pattern ${pattern}`);
  });
}

console.log("Version 1.0 manifest, icon, permission, and remote-code checks passed");
