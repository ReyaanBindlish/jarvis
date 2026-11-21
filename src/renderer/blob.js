// The glowing liquid sphere. One canvas, redrawn every frame from a state name and a 0..1 level.
//   idle      breathes, blue
//   listening ripples with the mic level, cyan
//   thinking  swirls, violet
//   speaking  pulses with the voice level, blue
//   error     red
const Orb = (() => {
  const cv = /** @type {HTMLCanvasElement} */ (document.getElementById("blob"));
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext("2d"));
  const W = cv.width;
  const C = W / 2;
  const BASE = 62;
  const N = 72;

  /** @type {Record<string, { h: number, s: number, l: number, amp: number, speed: number, spin: number }>} */
  const LOOK = {
    idle: { h: 212, s: 100, l: 56, amp: 0.03, speed: 0.9, spin: 0.25 },
    listening: { h: 194, s: 100, l: 58, amp: 0.045, speed: 2.2, spin: 0.5 },
    thinking: { h: 268, s: 96, l: 62, amp: 0.085, speed: 3.0, spin: 2.8 },
    speaking: { h: 216, s: 100, l: 60, amp: 0.035, speed: 1.8, spin: 0.6 },
    error: { h: 356, s: 92, l: 56, amp: 0.05, speed: 0.8, spin: 0.2 },
  };

  const cur = { ...LOOK.idle };
  let lv = 0;
  let scale = 1;
  let ripple = 0;
  let phase = 0;
  let rot = 0;
  let last = 0;

  const hsla = (/** @type {number} */ h, /** @type {number} */ s, /** @type {number} */ l, /** @type {number} */ a) =>
    `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${a.toFixed(3)})`;

  /** @param {number} t ms @param {string} state @param {number} level 0..1 */
  function draw(t, state, level) {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    const s = t / 1000;
    const T = LOOK[state] ?? LOOK.idle;
    for (const k of /** @type {(keyof typeof cur)[]} */ (Object.keys(cur))) cur[k] += (T[k] - cur[k]) * 0.08;
    lv += (Math.max(0, Math.min(1, level)) - lv) * 0.3;

    let amp = cur.amp;
    let want = 1 + 0.035 * Math.sin(s * 1.6); // breathing
    if (state === "listening") {
      amp += lv * 0.2;
      want = 1 + lv * 0.08;
    } else if (state === "speaking") {
      amp += lv * 0.14;
      want = 1 + lv * 0.22;
    } else if (state === "thinking") {
      want = 1 + 0.025 * Math.sin(s * 5);
    }
    scale += (want - scale) * 0.25;
    ripple += ((state === "listening" ? 1 : 0) - ripple) * 0.1;
    phase += cur.speed * dt;
    rot += cur.spin * dt;

    const R = BASE * scale;
    const { h, s: sat, l } = cur;
    g.clearRect(0, 0, W, W);

    // glow
    const glow = g.createRadialGradient(C, C, R * 0.5, C, C, R * 1.9);
    glow.addColorStop(0, hsla(h, sat, l, Math.min(0.9, 0.5 + lv * 0.4)));
    glow.addColorStop(0.45, hsla(h, sat, l, 0.16 + lv * 0.14));
    glow.addColorStop(1, hsla(h, sat, l, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, W, W);

    // ripples spreading out while listening
    if (ripple > 0.02) {
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const p = (s * 0.8 + i / 3) % 1;
        g.strokeStyle = hsla(h, sat, 74, (1 - p) * (0.14 + lv * 0.6) * ripple);
        g.beginPath();
        g.arc(C, C, R * (1.06 + p * 0.78), 0, Math.PI * 2);
        g.stroke();
      }
    }

    // liquid body
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const n =
        Math.sin(a * 3 + phase * 1.3 + rot) * 0.5 +
        Math.sin(a * 5 - phase * 1.9 + rot * 0.5) * 0.3 +
        Math.sin(a * 2 + phase * 0.7) * 0.4;
      const r = R * (1 + amp * n);
      const x = C + Math.cos(a) * r;
      const y = C + Math.sin(a) * r;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    const body = g.createRadialGradient(C - R * 0.3, C - R * 0.38, R * 0.05, C, C, R * 1.12);
    body.addColorStop(0, hsla(h - 8, 100, 88, 1));
    body.addColorStop(0.35, hsla(h, sat, l, 1));
    body.addColorStop(1, hsla(h + 14, 95, 22, 1));
    g.fillStyle = body;
    g.fill();

    // light swirling inside
    g.save();
    g.clip();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const a = rot * (1 + i * 0.35) + phase * 0.4 + i * 2.1;
      const d = R * (0.38 + 0.12 * Math.sin(phase * 0.9 + i));
      const x = C + Math.cos(a) * d;
      const y = C + Math.sin(a) * d;
      const sw = g.createRadialGradient(x, y, 0, x, y, R * 0.72);
      sw.addColorStop(0, hsla(h + (i - 1) * 28, 100, 72, 0.34 + lv * 0.2));
      sw.addColorStop(1, hsla(h + (i - 1) * 28, 100, 72, 0));
      g.fillStyle = sw;
      g.fillRect(0, 0, W, W);
    }
    g.globalCompositeOperation = "source-over";
    // darker rim, so it reads as a sphere
    const rim = g.createRadialGradient(C, C, R * 0.55, C, C, R * 1.15);
    rim.addColorStop(0, hsla(h, 90, 10, 0));
    rim.addColorStop(1, hsla(h + 10, 90, 10, 0.55));
    g.fillStyle = rim;
    g.fillRect(0, 0, W, W);
    // glossy highlight
    g.fillStyle = "rgba(255,255,255,0.42)";
    g.beginPath();
    g.ellipse(C - R * 0.36, C - R * 0.5, R * 0.26, R * 0.13, -0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  return { draw };
})();
