// Jarvis renderer: listen -> transcribe -> think -> speak -> idle.
/* global Orb, Pet */
(() => {
  const api = /** @type {any} */ (window).jarvis;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const island = $("island");
  const orb = $("orb");
  const statusEl = $("status");
  const heardEl = $("heard");
  const answerEl = $("answer");
  const form = /** @type {HTMLFormElement} */ ($("form"));
  const input = /** @type {HTMLInputElement} */ ($("input"));

  const SILENCE_MS = 1200; // stop this long after the last speech
  const NO_SPEECH_MS = 7000; // give up if nothing was said
  const MAX_MS = 15000;
  const LABEL = { idle: "Jarvis", listening: "Listening", thinking: "Thinking", speaking: "Jarvis", error: "Hmm" };

  let state = "idle";
  let open = false;
  let shot = false;
  let run = 0; // bumps on every new request or cancel; stale async work checks it and bails
  let level = 0;
  /** @type {(() => number) | null} */
  let meter = null;
  let lastActive = performance.now();
  let collapseTimer = 0;
  /** @type {AudioContext | null} */
  let actx = null;
  /** @type {{ stop: (submit: boolean) => void } | null} */
  let mic = null;
  /** @type {AudioBufferSourceNode | null} */
  let playing = null;

  function audio() {
    actx ??= new AudioContext();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }

  /** @param {string} next @param {string} [label] */
  function setState(next, label) {
    state = next;
    island.dataset.state = next;
    statusEl.textContent = label ?? LABEL[/** @type {keyof typeof LABEL} */ (next)] ?? "Jarvis";
    lastActive = performance.now();
  }

  function setOpen(/** @type {boolean} */ v) {
    open = v;
    island.classList.toggle("open", v);
    lastActive = performance.now();
    if (!v) input.blur();
  }

  function collapseSoon(ms = 5000) {
    clearTimeout(collapseTimer);
    if (shot) return;
    collapseTimer = window.setTimeout(() => {
      if (state !== "idle" && state !== "error") return;
      if (island.matches(":hover") || (document.activeElement === input && input.value)) return collapseSoon(3000);
      if (state === "error") setState("idle");
      setOpen(false);
    }, ms);
  }

  /** Stop the mic, any voice, and orphan any request in flight. */
  function cancel() {
    run++;
    clearTimeout(collapseTimer);
    mic?.stop(false);
    stopVoice();
  }

  function stopVoice() {
    try {
      playing?.stop();
    } catch {
      // already ended
    }
    playing = null;
    try {
      speechSynthesis.cancel();
    } catch {
      // no system voices
    }
    meter = null;
  }

  // ---------- voice out ----------

  /** Play ElevenLabs mp3 bytes through an analyser, so the blob pulses with the voice. */
  async function playBytes(/** @type {Uint8Array | ArrayBuffer} */ bytes, /** @type {number} */ id) {
    const ctx = audio();
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const decoded = await ctx.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    if (id !== run) return;
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    an.connect(ctx.destination);
    const data = new Float32Array(an.fftSize);
    meter = () => {
      an.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      return Math.min(1, Math.sqrt(sum / data.length) * 4.5);
    };
    playing = src;
    await new Promise((done) => {
      src.onended = done;
      src.start();
    });
    if (playing === src) {
      playing = null;
      meter = null;
    }
  }

  function britishVoice() {
    const voices = speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang === "en-GB" && /male|george|ryan|daniel/i.test(v.name) && !/female/i.test(v.name)) ??
      voices.find((v) => v.lang === "en-GB") ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null
    );
  }

  /** The system voice, when ElevenLabs is unavailable. Resolves when it stops talking. */
  function sayLocal(/** @type {string} */ text) {
    return new Promise((done) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(guard);
        meter = null;
        done(undefined);
      };
      // never hang the flow on a voice engine that stays silent
      const guard = window.setTimeout(finish, Math.min(30000, 2500 + text.length * 90));
      try {
        const u = new SpeechSynthesisUtterance(text);
        const v = britishVoice();
        if (v) u.voice = v;
        u.lang = v?.lang ?? "en-GB";
        u.rate = 1.02;
        u.onend = finish;
        u.onerror = finish;
        // no audio samples to read here, so fake a talking rhythm
        meter = () => {
          const s = performance.now() / 1000;
          return speechSynthesis.speaking ? 0.3 + 0.25 * Math.sin(s * 11) * Math.sin(s * 3.1) + 0.12 * Math.sin(s * 23) : 0;
        };
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch {
        finish();
      }
    });
  }

  /** Say the answer out loud, then settle back to idle. */
  async function speakOut(/** @type {string} */ text, /** @type {number} */ id) {
    answerEl.textContent = text;
    answerEl.scrollTop = 0;
    let bytes = null;
    try {
      bytes = await api.speak(text);
    } catch {
      bytes = null;
    }
    if (id !== run) return;
    setState("speaking");
    try {
      if (bytes && bytes.byteLength) await playBytes(bytes, id);
      else await sayLocal(text);
    } catch {
      if (id === run) await sayLocal(text);
    }
    if (id !== run) return;
    setState("idle");
    collapseSoon();
  }

  /** Red blob, a short visible and spoken message, then back to idle. */
  async function fail(/** @type {string} */ message) {
    const id = ++run;
    mic?.stop(false);
    stopVoice();
    setOpen(true);
    setState("error");
    answerEl.textContent = message;
    await sayLocal(message);
    if (id !== run) return;
    collapseSoon(4500);
  }

  // ---------- thinking ----------

  async function respond(/** @type {string} */ text, /** @type {number} */ id) {
    heardEl.textContent = text;
    answerEl.textContent = "";
    setState("thinking");
    let r;
    try {
      r = await api.ask(text);
    } catch {
      r = { ok: false, error: "Something went wrong. Try again." };
    }
    if (id !== run) return;
    if (!r?.ok) return fail(r?.error ?? "Something went wrong. Try again.");
    await speakOut(r.text, id);
  }

  // ---------- voice in ----------

  async function listen() {
    cancel();
    const id = run;
    setOpen(true);
    heardEl.textContent = "";
    answerEl.textContent = "";
    setState("listening");

    /** @type {MediaStream} */
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      if (id === run) fail("I can't reach the microphone. You can type instead.");
      return;
    }
    if (id !== run) return stream.getTracks().forEach((t) => t.stop());

    const ctx = audio();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const data = new Float32Array(an.fftSize);
    const rms = () => {
      an.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      return Math.sqrt(sum / data.length);
    };
    meter = () => Math.min(1, rms() * 7);

    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    /** @type {Blob[]} */
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const started = performance.now();
    let spoke = false;
    let loud = 0;
    let lastVoice = started;
    let noise = 0;
    let noiseN = 0;
    let submit = false;
    let stopped = false;

    const watch = setInterval(() => {
      const now = performance.now();
      const v = rms();
      if (now - started < 300) {
        // learn the room before judging what counts as speech
        noise += v;
        noiseN++;
        return;
      }
      const threshold = Math.max(0.014, (noiseN ? noise / noiseN : 0) * 2.6);
      if (v > threshold) {
        loud++;
        if (loud >= 2) {
          spoke = true;
          lastVoice = now;
        }
      } else loud = 0;
      if (spoke && now - lastVoice > SILENCE_MS) session.stop(true);
      else if (!spoke && now - started > NO_SPEECH_MS) session.stop(true);
      else if (now - started > MAX_MS) session.stop(true);
    }, 50);

    const session = {
      stop(/** @type {boolean} */ wantSubmit) {
        if (stopped) return;
        stopped = true;
        submit = wantSubmit;
        clearInterval(watch);
        if (mic === session) mic = null;
        meter = null;
        try {
          rec.stop();
        } catch {
          finish();
        }
      },
    };
    mic = session;

    let finished = false;
    async function finish() {
      if (finished) return;
      finished = true;
      stream.getTracks().forEach((t) => t.stop());
      src.disconnect();
      if (!submit || id !== run) return;
      if (!spoke) {
        setState("idle");
        answerEl.textContent = "I didn't hear anything. Press Alt+J to try again, or type below.";
        return collapseSoon(4000);
      }
      setState("thinking", "Transcribing");
      let r;
      try {
        const bytes = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
        r = await api.transcribe(bytes, rec.mimeType || "audio/webm");
      } catch {
        r = { ok: false, error: "I couldn't transcribe that." };
      }
      if (id !== run) return;
      if (!r?.ok) return fail(r?.error ?? "I couldn't transcribe that.");
      const text = String(r.text ?? "").trim();
      if (!text) {
        setState("idle");
        answerEl.textContent = "I didn't catch that.";
        return collapseSoon(4000);
      }
      await respond(text, id);
    }
    rec.onstop = finish;
    rec.onerror = () => session.stop(false);
    rec.start();
  }

  /** Alt+J, the tray, or a click on the blob. */
  function trigger() {
    if (state === "listening" && mic) return mic.stop(true); // done talking
    if (state === "thinking") return; // already on it
    listen();
  }

  // ---------- input ----------

  island.addEventListener("mouseenter", () => {
    lastActive = performance.now();
    api.hover(true);
  });
  island.addEventListener("mouseleave", () => api.hover(false));
  island.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    api.menu();
  });
  island.addEventListener("click", (e) => {
    const target = /** @type {Node} */ (e.target);
    if (form.contains(target)) return;
    if (!open) return trigger();
    if (orb.contains(target)) {
      Pet.mood("happy", 700);
      trigger();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    cancel();
    setOpen(true);
    respond(text, run);
  });
  input.addEventListener("input", () => {
    lastActive = performance.now();
    if (state === "listening") {
      // typing instead: drop the mic
      cancel();
      setState("idle");
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    cancel();
    setState("idle");
    setOpen(false);
  });

  api.on("ask", trigger);
  api.on("open", () => {
    setOpen(true);
    collapseSoon(8000);
  });
  api.on("collapse", () => {
    if (state === "idle" && !shot) setOpen(false);
  });
  api.on("cursor", (/** @type {{ x: number, y: number }} */ p) => Pet.look(p.x, p.y));
  try {
    speechSynthesis.getVoices(); // voices load lazily; ask early
  } catch {
    // no system voices
  }

  api.init().then((/** @type {{ name: string, shot: boolean }} */ init) => {
    shot = Boolean(init?.shot);
    if (init?.name) answerEl.textContent = `Hello ${init.name}. Press Alt+J and talk, or type below.`;
  });

  // ---------- frame loop ----------

  function frame(/** @type {number} */ t) {
    const target = meter ? Math.max(0, meter()) : 0;
    level += (target - level) * (target > level ? 0.5 : 0.18);
    Orb.draw(t, state, level);
    const awake = shot || state !== "idle" || open || t - lastActive < 25000;
    Pet.tick(t, awake, open);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
