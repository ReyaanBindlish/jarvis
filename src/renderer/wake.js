// Wake word: decide whether a transcript addressed Jarvis, and what was asked.
(function (root) {
  const NAME =
    /(?:^|[^\p{L}\p{M}])(?:(?:hey|hi|hello|ok|okay|hay|हे|अरे)[\s,]+)?(jarvis|jarvish|jervis|jaarvis|javis|जार्विस|जारविस|जार्विश)(?=$|[^\p{L}\p{M}])/iu;

  /**
   * @param {string} text what the microphone heard
   * @returns {{ query: string } | null} null when Jarvis was not addressed; an empty query means "just woke me"
   */
  function parseWake(text) {
    const s = String(text ?? "").trim();
    const m = NAME.exec(s);
    if (!m) return null;
    const after = s
      .slice(m.index + m[0].length)
      .replace(/^[\s,.!?:;।-]+/u, "")
      .trim();
    const words = after.split(/\s+/).filter(Boolean);
    return { query: words.length >= 2 ? after : "" };
  }

  /**
   * Float32 blocks at `rate` Hz to a 16 kHz mono 16-bit WAV.
   * @param {Float32Array[]} blocks @param {number} rate
   */
  function toWav(blocks, rate) {
    let n = 0;
    for (const b of blocks) n += b.length;
    const all = new Float32Array(n);
    let o = 0;
    for (const b of blocks) {
      all.set(b, o);
      o += b.length;
    }
    const step = rate / 16000;
    const len = Math.floor(n / step);
    const out = new DataView(new ArrayBuffer(44 + len * 2));
    const str = (/** @type {number} */ at, /** @type {string} */ v) =>
      [...v].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
    str(0, "RIFF");
    out.setUint32(4, 36 + len * 2, true);
    str(8, "WAVEfmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 1, true);
    out.setUint32(24, 16000, true);
    out.setUint32(28, 32000, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, "data");
    out.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const a = Math.floor(i * step);
      const b = Math.min(n, Math.floor((i + 1) * step));
      let sum = 0;
      for (let j = a; j < b; j++) sum += all[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
      out.setInt16(44 + i * 2, v * 32767, true);
    }
    return out.buffer;
  }

  const api = { parseWake, toWav };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Wake = api;
})(typeof window !== "undefined" ? window : globalThis);
