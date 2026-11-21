'use strict';

// Jarvis brain: decides whether a question is weather, mood or general,
// and answers it. Pure module: no Electron, no disk, fetch is injectable.

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-fable-5-2';
const DEFAULT_CITY = 'New Delhi';

const WEATHER_EN = /\b(weather|temperature|temp|forecast|rain|rains|raining|rainy|rainfall|hot|cold|humid|humidity|sunny|umbrella)\b/i;
const WEATHER_HINGLISH = /\b(mausam|mosam|tapman|taapmaan|tapmaan|baarish|barish|garmi|garam|thand|thanda|thandi)\b/i;
const WEATHER_HI = ['मौसम', 'तापमान', 'बारिश', 'गर्मी', 'गरमी', 'ठंड'];

function isWeather(text) {
  const t = String(text || '');
  return WEATHER_EN.test(t) || WEATHER_HINGLISH.test(t) || WEATHER_HI.some((w) => t.includes(w));
}

function isMood(text) {
  const t = String(text || '');
  return /\b(mood|vibe|vibes)\b/i.test(t) || t.includes('मूड');
}

// Words that can never be (part of) a city name at the edges of a phrase.
const FILLER = new Set([
  'today', 'now', 'right', 'tomorrow', 'tonight', 'currently', 'please', 'like', 'outside',
  'aaj', 'abhi', 'kal', 'hai', 'kya', 'kaisa', 'kaisi', 'batao', 'bata', 'do', 'zara',
  'the', 'a', 'is', 'it', 'what', "what's", 'whats', 'how', "how's", 'hows', 'will', 'does',
  'tell', 'give', 'show', 'let', 'hey', 'hi', 'ok', 'okay', 'jarvis', 'and', 'aur', 'this',
  'weather', 'temperature', 'temp', 'forecast', 'rain', 'raining', 'hot', 'cold',
  'mausam', 'tapman', 'baarish', 'barish', 'garmi', 'thand',
  'moment', 'morning', 'evening', 'afternoon', 'night', 'week', 'weekend', 'here', 'my', 'city', 'area',
  'आज', 'अभी', 'कल', 'है', 'क्या', 'कैसा', 'बताओ', 'जार्विस', 'और',
  'मौसम', 'तापमान', 'बारिश', 'गर्मी', 'ठंड',
]);
const PREPOSITIONS = new Set(['in', 'at', 'for']);
const PARTICLES = new Set(['ka', 'ki', 'ke', 'mein', 'me', 'main', 'mai', 'का', 'की', 'के', 'में']);

const isFiller = (w) => FILLER.has(w.toLowerCase());

function tidyCity(words) {
  const w = words.slice();
  while (w.length && isFiller(w[w.length - 1])) w.pop();
  while (w.length && isFiller(w[0])) w.shift();
  if (!w.length || w.some((x) => PREPOSITIONS.has(x.toLowerCase()) || PARTICLES.has(x.toLowerCase()))) return '';
  return w
    .map((x) => (/^[a-z]/.test(x) ? x[0].toUpperCase() + x.slice(1) : x))
    .join(' ');
}

function parseCity(text, fallback) {
  const fb = fallback || DEFAULT_CITY;
  const words = String(text || '')
    .replace(/[?!.,;:।"“”()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return fb;

  // English: everything after the last "in" / "at" / "for".
  for (let i = words.length - 1; i >= 0; i--) {
    if (PREPOSITIONS.has(words[i].toLowerCase())) {
      const city = tidyCity(words.slice(i + 1));
      if (city) return city;
      break;
    }
  }

  // Hindi and Hinglish: the words right before "ka" / "mein" / "का" / "में".
  for (let i = 1; i < words.length; i++) {
    if (!PARTICLES.has(words[i].toLowerCase())) continue;
    const before = [];
    for (let j = i - 1; j >= 0 && before.length < 3; j--) {
      if (isFiller(words[j]) || PARTICLES.has(words[j].toLowerCase())) break;
      before.unshift(words[j]);
    }
    const city = tidyCity(before);
    if (city) return city;
  }

  return fb;
}

const WMO = {
  0: 'clear skies',
  1: 'mostly clear skies',
  2: 'partly cloudy skies',
  3: 'overcast skies',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'light freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'violent showers',
  85: 'light snow showers',
  86: 'heavy snow showers',
  95: 'a thunderstorm',
  96: 'a thunderstorm with hail',
  99: 'a thunderstorm with heavy hail',
};

function describeCode(code) {
  return WMO[code] || 'unsettled weather';
}

function getFetch(opts) {
  const f = (opts && opts.fetch) || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('No fetch available');
  return f;
}

const round = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n) : null);

async function getWeather(city, opts) {
  const fetch = getFetch(opts);
  const name = String(city || DEFAULT_CITY).trim() || DEFAULT_CITY;

  const geoRes = await fetch(`${GEO_URL}?name=${encodeURIComponent(name)}&count=1`);
  if (!geoRes.ok) throw new Error(`Weather lookup failed (${geoRes.status})`);
  const geo = await geoRes.json();
  const place = geo && geo.results && geo.results[0];
  if (!place) throw new Error(`I couldn't find a place called ${name}`);

  const url =
    `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather lookup failed (${res.status})`);
  const data = await res.json();
  const cur = (data && data.current) || {};
  const daily = (data && data.daily) || {};
  if (typeof cur.temperature_2m !== 'number') throw new Error(`No weather data for ${name}`);

  return {
    city: place.name || name,
    temp: round(cur.temperature_2m),
    feels: round(cur.apparent_temperature),
    humidity: round(cur.relative_humidity_2m),
    wind: round(cur.wind_speed_10m),
    code: cur.weather_code,
    description: describeCode(cur.weather_code),
    max: round((daily.temperature_2m_max || [])[0]),
    min: round((daily.temperature_2m_min || [])[0]),
  };
}

function weatherSentence(w) {
  let s = `It's ${w.temp} degrees in ${w.city}`;
  if (w.feels !== null) s += `, feels like ${w.feels}`;
  s += `, with ${w.description}.`;
  if (w.max !== null && w.min !== null) s += ` Today's high is ${w.max} and the low ${w.min}.`;
  return s;
}

function weatherFeel(w) {
  const t = w.feels !== null ? w.feels : w.temp;
  let feel = 'scorching';
  if (t < 10) feel = 'chilly';
  else if (t < 18) feel = 'cool';
  else if (t < 27) feel = 'pleasant';
  else if (t < 34) feel = 'warm';
  else if (t < 40) feel = 'hot';
  return `It's a ${feel} ${w.temp} degrees in ${w.city} with ${w.description}.`;
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*`#~]/g, '')
    .replace(/(^|\s)_+([^_]+?)_+(?=[\s.,!?;:]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function systemPrompt(keys) {
  const name = (keys && keys.name) || 'sir';
  return (
    `You are Jarvis, a concise British butler voice assistant for ${name}. ` +
    "Reply in the user's language (English, Hindi or Hinglish). " +
    'Your reply is spoken aloud, so answer in 1 to 3 short spoken sentences. ' +
    'No markdown, no lists, no URLs. ' +
    'If you search the web, do not narrate the search; just give the answer.'
  );
}

async function askClaude(text, keys, opts) {
  const k = keys || {};
  const apiKey = String(k.anthropic || '').trim();
  if (!apiKey) throw new Error('No Anthropic key set');
  const fetch = getFetch(opts);

  const messages = [{ role: 'user', content: String(text || '') }];
  let spoken = '';

  for (let turn = 0; turn <= 2; turn++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: k.model || DEFAULT_MODEL,
        max_tokens: 1024,
        system: systemPrompt(k),
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      }),
      signal: opts && opts.signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = (body && body.error && body.error.message) || '';
      } catch (_) {
        // body was not JSON; the status code is enough
      }
      throw new Error(`Anthropic request failed (${res.status})${detail ? ': ' + detail : ''}`);
    }

    const data = await res.json();
    const content = Array.isArray(data.content) ? data.content : [];
    spoken += content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');

    if (data.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content });
  }

  return stripMarkdown(spoken) || "I'm afraid I have no answer for that.";
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';
const NO_SEARCH_NOTE =
  ' You cannot search the web right now. If the question needs information from today, ' +
  'say in one short sentence that live search is unavailable, then give what you do know.';

async function geminiCall(model, withSearch, text, k, opts) {
  const fetch = getFetch(opts);
  const res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': String(k.gemini).trim(), 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(k) + (withSearch ? '' : NO_SEARCH_NOTE) }] },
      contents: [{ role: 'user', parts: [{ text: String(text || '') }] }],
      ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
      // a spoken answer should come back fast; only set on the built-in models, whose API accepts it
      ...(model === DEFAULT_GEMINI_MODEL || model === GEMINI_FALLBACK_MODEL
        ? { generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }
        : {}),
    }),
    signal: (opts && opts.signal) || AbortSignal.timeout(withSearch ? 20000 : 15000),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = (body && body.error && body.error.message) || '';
    } catch (_) {
      // body was not JSON; the status code is enough
    }
    const err = new Error(`Gemini request failed (${res.status})${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts
    .filter((p) => p && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

/**
 * Gemini with Google Search grounding. Used instead of Claude when a gemini key is set.
 * Search needs paid quota on the Google project: when Google refuses it (429) the same
 * question is asked without search. A busy or retired model (503, 404) falls to the next one.
 */
async function askGemini(text, keys, opts) {
  const k = keys || {};
  if (!String(k.gemini || '').trim()) throw new Error('No Gemini key set');
  const models = [...new Set([k.gemini_model || DEFAULT_GEMINI_MODEL, GEMINI_FALLBACK_MODEL])];
  let last;
  for (const model of models) {
    for (const withSearch of [true, false]) {
      try {
        const spoken = await geminiCall(model, withSearch, text, k, opts);
        return stripMarkdown(spoken.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '')) || "I'm afraid I have no answer for that.";
      } catch (err) {
        last = err;
        if (err.status === 429 && withSearch) continue; // no search quota: try plain
        const slow = err.name === 'TimeoutError' || err.name === 'AbortError';
        if (err.status === 429 || err.status === 503 || err.status === 404 || slow) break; // next model
        throw err;
      }
    }
  }
  throw last;
}

const hasBrain = (k) => Boolean(String(k.gemini || '').trim() || String(k.anthropic || '').trim());

/** Everything that is not weather: Gemini when its key is set, otherwise Claude. */
function think(text, k, opts) {
  return String(k.gemini || '').trim() ? askGemini(text, k, opts) : askClaude(text, k, opts);
}

async function ask(text, keys, opts) {
  const k = keys || {};
  const home = k.city || DEFAULT_CITY;

  if (isWeather(text)) {
    return weatherSentence(await getWeather(parseCity(text, home), opts));
  }

  if (isMood(text)) {
    let feel = '';
    try {
      feel = weatherFeel(await getWeather(home, opts));
    } catch (err) {
      if (!hasBrain(k)) throw err;
    }
    if (!hasBrain(k)) return feel;

    const prompt =
      `The user asked: "${text}". Give today's vibe in 2 to 3 short spoken sentences. ` +
      (feel ? `Weather facts for ${home}: ${feel} Open with how that weather feels. ` : '') +
      "Then search for India's biggest news today and say what the overall mood of the news is.";
    try {
      return await think(prompt, k, opts);
    } catch (err) {
      if (feel) return feel;
      throw err;
    }
  }

  return think(text, k, opts);
}

module.exports = {
  isWeather,
  isMood,
  parseCity,
  getWeather,
  askClaude,
  askGemini,
  ask,
  describeCode,
  stripMarkdown,
  weatherSentence,
  weatherFeel,
};
