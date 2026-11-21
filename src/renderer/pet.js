// Adapted from Music Notch by Ritesh Roshan (MIT).
// The eyes on the blob. They follow your cursor anywhere on screen, blink at random,
// doze when Jarvis has been idle a while, and go happy on hover (that part is CSS).
const Pet = (() => {
  const pet = /** @type {HTMLElement} */ (document.getElementById("pet"));
  const face = /** @type {HTMLElement} */ (document.getElementById("face"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** @type {{ x: number, y: number } | null} */
  let cursor = null;
  let ex = 0;
  let ey = 0;
  let nearS = 0;
  let blinkAt = -1e9;
  let nextBlink = 1200;
  let double = false;
  /** @type {Record<string, number>} */
  const timers = {};

  /** Where the cursor is, in this window's CSS pixels. @param {number} x @param {number} y */
  function look(x, y) {
    cursor = { x, y };
  }

  /** Show a mood for a moment. @param {string} name @param {number} ms */
  function mood(name, ms) {
    pet.classList.add(name);
    clearTimeout(timers[name]);
    timers[name] = window.setTimeout(() => pet.classList.remove(name), ms);
  }

  const clamp = (/** @type {number} */ v) => Math.max(-1, Math.min(1, v));

  /**
   * One frame: follow the cursor and blink.
   * @param {number} t @param {boolean} awake @param {boolean} open
   */
  function tick(t, awake, open) {
    pet.classList.toggle("sleepy", !awake);
    if (reduced) return;

    let tx = 0;
    let ty = 0;
    let near = 0;
    if (cursor && awake) {
      const r = face.getBoundingClientRect();
      const dx = cursor.x - (r.left + r.width / 2);
      const dy = cursor.y - (r.top + r.height / 2);
      const reach = open ? 9 : 2.6; // how far the eyes may wander, in px
      tx = clamp(dx / 160) * reach;
      ty = clamp(dy / 110) * reach * 0.6;
      near = Math.max(0, 1 - Math.hypot(dx, dy) / 140); // perk up as the cursor comes close
    }
    nearS += (near - nearS) * 0.12;
    face.style.setProperty("--near", nearS.toFixed(3));
    ex += (tx - ex) * 0.16;
    ey += (ty - ey) * 0.16;
    face.style.setProperty("--ex", `${ex.toFixed(2)}px`);
    face.style.setProperty("--ey", `${ey.toFixed(2)}px`);

    // blink every 2.6 to 5.2 s, sometimes twice in a row
    if (t > nextBlink && awake) {
      blinkAt = t;
      double = Math.random() < 0.22;
      nextBlink = t + 2600 + Math.random() * 2600;
    }
    const since = t - blinkAt;
    const shut = since < 110 || (double && since > 220 && since < 330);
    face.style.setProperty("--lid", shut ? "0.12" : "1");
  }

  return { look, mood, tick };
})();
