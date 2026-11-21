// Adapted from Music Notch by Ritesh Roshan (MIT).
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set(["ask", "open", "collapse", "cursor"]);

contextBridge.exposeInMainWorld("jarvis", {
  init: () => ipcRenderer.invoke("init"),
  transcribe: (/** @type {ArrayBuffer} */ audio, /** @type {string} */ mime) =>
    ipcRenderer.invoke("transcribe", audio, mime),
  ask: (/** @type {string} */ text) => ipcRenderer.invoke("ask", text),
  speak: (/** @type {string} */ text) => ipcRenderer.invoke("speak", text),
  hover: (/** @type {boolean} */ inside) => ipcRenderer.send("hover", inside),
  menu: () => ipcRenderer.send("menu"),
  on: (/** @type {string} */ channel, /** @type {(v: any) => void} */ fn) => {
    if (CHANNELS.has(channel)) ipcRenderer.on(channel, (_e, v) => fn(v));
  },
});
