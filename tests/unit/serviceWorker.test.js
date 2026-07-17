"use strict";

// Verifies that Solo snapshots remain independent for multiple Google account
// routes within the same Chrome profile.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const values = {};
let messageListener;
const context = vm.createContext({
  console,
  chrome: {
    storage: {
      session: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, values[key]]));
        },
        async set(updates) {
          Object.assign(values, structuredClone(updates));
        },
        async remove(key) {
          delete values[key];
        }
      }
    },
    runtime: {
      onMessage: { addListener: (listener) => { messageListener = listener; } }
    }
  }
});

const workerPath = path.resolve(__dirname, "../../src/background/serviceWorker.js");
vm.runInContext(fs.readFileSync(workerPath, "utf8"), context, { filename: workerPath });

function send(message) {
  return new Promise((resolve) => {
    assert.strictEqual(messageListener(message, {}, resolve), true);
  });
}

async function run() {
  const accountZero = { active: true, activeGroupId: "production", previousVisibility: { a: true } };
  const accountOne = { active: true, activeGroupId: "personal", previousVisibility: { b: false } };

  assert.deepStrictEqual(
    structuredClone(await send({ type: "GCAL_GROUPS_SOLO_SET", scope: "account:0", state: accountZero })),
    { ok: true }
  );
  assert.deepStrictEqual(
    structuredClone(await send({ type: "GCAL_GROUPS_SOLO_SET", scope: "account:1", state: accountOne })),
    { ok: true }
  );
  assert.deepStrictEqual(
    structuredClone((await send({ type: "GCAL_GROUPS_SOLO_GET", scope: "account:0" })).state),
    accountZero
  );
  assert.deepStrictEqual(
    structuredClone((await send({ type: "GCAL_GROUPS_SOLO_GET", scope: "account:1" })).state),
    accountOne
  );

  await send({ type: "GCAL_GROUPS_SOLO_CLEAR", scope: "account:0" });
  assert.strictEqual((await send({ type: "GCAL_GROUPS_SOLO_GET", scope: "account:0" })).state, null);
  assert.deepStrictEqual(
    structuredClone((await send({ type: "GCAL_GROUPS_SOLO_GET", scope: "account:1" })).state),
    accountOne
  );
  console.log("Version 1.0 account-scoped Solo tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
