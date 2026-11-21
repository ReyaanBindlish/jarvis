// Speech in and out, main process only. Uses global fetch / FormData / Blob.
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George, British

const timeout = (ms) => AbortSignal.timeout(ms);

async function groq(buffer, mime, key) {
  const type = (mime || "audio/webm").split(";")[0];
  const ext = type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : type.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), `audio.${ext}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");
  // no language param: English, Hindi and Hinglish are auto-detected
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: timeout(20000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  return String((await res.json()).text ?? "").trim();
}

async function deepgram(buffer, mime, key) {
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true", {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": (mime || "audio/webm").split(";")[0] },
    body: buffer,
    signal: timeout(20000),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}`);
  const json = await res.json();
  return String(json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

/**
 * Audio bytes to text. Groq Whisper first, Deepgram as the fallback.
 * Throws an Error with code "NO_KEYS" when neither key is set.
 * @param {Buffer} buffer @param {string} mime @param {Record<string, string>} keys
 * @returns {Promise<string>}
 */
async function transcribe(buffer, mime, keys) {
  if (!keys?.groq && !keys?.deepgram) {
    throw Object.assign(new Error("No speech-to-text key"), { code: "NO_KEYS" });
  }
  let last;
  if (keys.groq) {
    try {
      return await groq(buffer, mime, keys.groq);
    } catch (e) {
      last = e;
    }
  }
  if (keys.deepgram) {
    try {
      return await deepgram(buffer, mime, keys.deepgram);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/**
 * Text to mp3 via ElevenLabs. Returns null when there is no key or the call fails,
 * and the renderer then falls back to the system voice.
 * @param {string} text @param {Record<string, string>} keys
 * @returns {Promise<Buffer | null>}
 */
async function speak(text, keys) {
  if (!keys?.elevenlabs || !text) return null;
  try {
    const voice = encodeURIComponent(keys.voice || DEFAULT_VOICE);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": keys.elevenlabs, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
      signal: timeout(20000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

module.exports = { transcribe, speak, DEFAULT_VOICE };
