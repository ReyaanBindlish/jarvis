// Keys live in %APPDATA%\Jarvis\keys.json and nowhere else. Nothing is hardcoded.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULTS = {
  anthropic: "",
  groq: "",
  deepgram: "",
  elevenlabs: "",
  voice: "",
  model: "claude-fable-5-2",
  city: "New Delhi",
  name: "",
  wake: "on", // "off" stops listening for "Hey Jarvis"
};

function file() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Jarvis", "keys.json");
}

/** Create the file with blanks if it is missing. Never overwrites an existing file. */
function ensure() {
  const f = file();
  try {
    if (!fs.existsSync(f)) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(DEFAULTS, null, 2) + "\n", { flag: "wx" });
    }
  } catch {
    // unreadable profile: load() falls back to defaults
  }
  return f;
}

/** Read fresh every call, so edits take effect without a restart. */
function load() {
  const keys = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(ensure(), "utf8").replace(/^﻿/, ""));
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof raw?.[k] === "string" && raw[k].trim()) keys[k] = raw[k].trim();
    }
  } catch {
    // missing or malformed: blanks
  }
  return keys;
}

/** Change one field, keeping everything else in the file as it is. */
function set(/** @type {string} */ key, /** @type {string} */ value) {
  const f = ensure();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return; // never overwrite a file we could not read
  }
  raw[key] = value;
  fs.writeFileSync(f, JSON.stringify(raw, null, 2) + "\n");
}

module.exports = { load, ensure, file, set, DEFAULTS };
