// Jarvis: a mini Siri in a notch at the top of the screen.
// Window shell (transparent, frameless, always-on-top, click-through except on hover, tray)
// adapted from Music Notch by Ritesh Roshan (MIT).
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, session, shell } =
  require("electron");
const fs = require("node:fs");
const path = require("node:path");
const keys = require("./keys.js");
const voice = require("./voice.js");

const WIDTH = 580;
const HEIGHT = 300;
const NO_KEYS = "Set your keys first: right-click, Set keys.";

const shot = process.env.JARVIS_SHOT || "";
const tooling = Boolean(shot);

if (!tooling && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
// Alt+J is not a user gesture as far as Chromium is concerned; let audio play anyway.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

/** @param {BrowserWindow | null} w @returns {w is BrowserWindow} */
const alive = (w) => w !== null && !w.isDestroyed();

function send(/** @type {string} */ channel, /** @type {any} */ value) {
  if (alive(win)) win.webContents.send(channel, value);
}

const placement = () => {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: Math.round(workArea.x + (workArea.width - WIDTH) / 2), y: workArea.y };
};

function createWindow() {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    ...placement(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win = w;
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.setAlwaysOnTop(true, "pop-up-menu");
  if (!tooling) w.setIgnoreMouseEvents(true, { forward: true });
  w.on("close", (e) => {
    if (!quitting && !tooling) e.preventDefault();
  });
  w.on("session-end", () => {
    quitting = true;
  });
  w.on("closed", () => {
    if (win === w) win = null;
  });
  w.webContents.on("render-process-gone", (_e, details) => {
    if (!quitting && details.reason !== "clean-exit") setTimeout(() => alive(w) && w.reload(), 1000);
  });
  w.loadFile(path.join(__dirname, "renderer", "index.html"));
  w.once("ready-to-show", () => (tooling ? w.show() : w.showInactive()));
  w.on("blur", () => !tooling && send("collapse"));
  if (tooling) w.webContents.once("did-finish-load", () => void shoot(w));
}

// ---------- test hook: JARVIS_SHOT=<path prefix> ----------

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {BrowserWindow} w */
async function shoot(w) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
    await wait(1500);
    fs.writeFileSync(`${shot}-closed.png`, (await w.webContents.capturePage()).toPNG());
    send("open");
    await wait(1500);
    fs.writeFileSync(`${shot}-open.png`, (await w.webContents.capturePage()).toPNG());
  } catch (e) {
    console.error("shot failed:", e);
    process.exitCode = 1;
  }
  app.quit();
}

// ---------- ask ----------

function ask() {
  if (!alive(win)) return;
  if (!win.isVisible()) win.showInactive();
  win.focus();
  send("ask");
}

function setKeys() {
  shell.openPath(keys.ensure());
}

// ---------- menu and tray ----------

/** A small blue orb, drawn in code so the app ships no image files. */
function trayIcon() {
  const n = 32;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5) / 14;
      const a = Math.max(0, Math.min(1, (1 - d) * 14));
      const hi = Math.max(0, 1 - Math.hypot(x - 11, y - 10) / 12);
      const i = (y * n + x) * 4;
      buf[i] = Math.round(255 * a); // B
      buf[i + 1] = Math.round((120 + 110 * hi) * a); // G
      buf[i + 2] = Math.round((30 + 190 * hi) * a); // R
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n, scaleFactor: 2 });
}

function appMenu() {
  return Menu.buildFromTemplate([
    { label: "Ask", accelerator: "Alt+J", click: ask },
    { label: "Set keys", click: setKeys },
    {
      label: "Open at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Jarvis (Alt+J)");
  tray.on("right-click", () => tray?.popUpContextMenu(appMenu()));
  tray.on("click", ask);
}

// ---------- ipc ----------

ipcMain.on("menu", () => alive(win) && appMenu().popup({ window: win }));
ipcMain.on("hover", (_e, inside) => {
  if (!alive(win) || tooling) return;
  win.setIgnoreMouseEvents(!inside, { forward: true });
});

ipcMain.handle("init", () => ({ name: keys.load().name, shot: tooling }));

ipcMain.handle("transcribe", async (_e, audio, mime) => {
  try {
    const buf = Buffer.from(audio);
    if (!buf.length || buf.length > 25 * 1024 * 1024) return { ok: false, error: "I couldn't hear that." };
    const text = await voice.transcribe(buf, typeof mime === "string" ? mime : "audio/webm", keys.load());
    return { ok: true, text };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === "NO_KEYS") return { ok: false, error: NO_KEYS };
    console.error("transcribe:", /** @type {any} */ (e)?.message ?? e);
    return { ok: false, error: "I couldn't transcribe that. Check your connection and keys." };
  }
});

ipcMain.handle("ask", async (_e, text) => {
  const k = keys.load();
  try {
    const q = String(text ?? "").trim().slice(0, 2000);
    if (!q) return { ok: false, error: "I didn't catch that." };
    const answer = await require("./brain.js").ask(q, k);
    const out = String(answer ?? "").trim();
    return out ? { ok: true, text: out } : { ok: false, error: "I have no answer for that." };
  } catch (e) {
    console.error("ask:", /** @type {any} */ (e)?.message ?? e);
    return { ok: false, error: k.anthropic ? "Something went wrong. Try again." : NO_KEYS };
  }
});

ipcMain.handle("speak", async (_e, text) => {
  try {
    return await voice.speak(String(text ?? "").slice(0, 2000), keys.load());
  } catch {
    return null;
  }
});

// ---------- boot ----------

app.on("second-instance", () => !quitting && ask());
app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  app.setAppUserModelId("com.jarvis.notch");
  keys.ensure();
  // The mic is the only permission the page ever needs.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  createWindow();
  if (tooling) return;
  buildTray();
  if (!globalShortcut.register("Alt+J", ask)) console.error("Alt+J is taken by another app");
  followCursor();
  screen.on("display-metrics-changed", () => {
    if (!alive(win)) return;
    const p = placement();
    win.setPosition(p.x, p.y);
  });
});

/** Tell the pet where the cursor is, in window pixels, whenever it moves. */
function followCursor() {
  let last = "";
  setInterval(() => {
    if (!alive(win)) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const key = `${p.x - b.x},${p.y - b.y}`;
    if (key === last) return;
    last = key;
    send("cursor", { x: p.x - b.x, y: p.y - b.y });
  }, 33);
}
