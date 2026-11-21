'use strict';

const test = require('node:test');
const assert = require('node:assert');
const brain = require('../src/brain.js');

// Mocked fetch only: no test in this file touches the network.
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) {
        const r = typeof reply === 'function' ? reply(calls.length, init) : reply;
        const status = r.status || 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => r.body,
          text: async () => JSON.stringify(r.body),
        };
      }
    }
    throw new Error('Unexpected fetch: ' + url);
  };
  fn.calls = calls;
  return fn;
}

const GEO = { body: { results: [{ name: 'Mumbai', latitude: 19.07, longitude: 72.88 }] } };
const FORECAST = {
  body: {
    current: {
      temperature_2m: 30.6,
      apparent_temperature: 35.2,
      relative_humidity_2m: 70,
      weather_code: 61,
      wind_speed_10m: 12.4,
    },
    daily: { temperature_2m_max: [33.1], temperature_2m_min: [26.8] },
  },
};
const weatherRoutes = [
  ['geocoding-api.open-meteo.com', GEO],
  ['api.open-meteo.com/v1/forecast', FORECAST],
];

test('isWeather: English', () => {
  for (const q of [
    "What's the weather in Mumbai?",
    'temperature at Pune today',
    'Will it rain tomorrow?',
    'give me the forecast',
    'Is it hot outside?',
    'how cold is it',
  ]) assert.strictEqual(brain.isWeather(q), true, q);
});

test('isWeather: Hindi and Hinglish', () => {
  for (const q of [
    'मुंबई का मौसम',
    'आज तापमान कितना है',
    'क्या बारिश होगी',
    'बहुत गर्मी है क्या',
    'ठंड कितनी है',
    'Mumbai ka mausam',
    'aaj tapman kitna hai',
    'kya baarish hogi',
    'barish kab hogi',
    'bahut garmi hai kya',
    'thand kitni hai',
  ]) assert.strictEqual(brain.isWeather(q), true, q);
});

test('isWeather: negatives', () => {
  for (const q of [
    'Who is the prime minister of India?',
    'tell me a joke',
    "what's the mood",
    'take a screenshot',
    'train kab aayegi',
    'भारत की राजधानी क्या है',
    '',
  ]) assert.strictEqual(brain.isWeather(q), false, q);
});

test('isMood', () => {
  for (const q of ["what's the mood", 'mood kya hai', 'aaj ka mood', "what's the vibe today"]) {
    assert.strictEqual(brain.isMood(q), true, q);
  }
  for (const q of ['what is the weather', 'play some music', '']) {
    assert.strictEqual(brain.isMood(q), false, q);
  }
});

test('parseCity', () => {
  const cases = [
    ['weather in Mumbai', 'Mumbai'],
    ["What's the weather in Mumbai?", 'Mumbai'],
    ['temperature at Pune today', 'Pune'],
    ['weather in New Delhi right now', 'New Delhi'],
    ['is it raining in bengaluru tomorrow?', 'Bengaluru'],
    ['Mumbai ka mausam', 'Mumbai'],
    ['Delhi mein mausam kaisa hai', 'Delhi'],
    ['aaj Pune ka mausam kaisa hai', 'Pune'],
    ['मुंबई का मौसम', 'मुंबई'],
    ['दिल्ली में मौसम कैसा है?', 'दिल्ली'],
  ];
  for (const [q, city] of cases) assert.strictEqual(brain.parseCity(q), city, q);
});

test('parseCity: fallback', () => {
  assert.strictEqual(brain.parseCity("what's the weather"), 'New Delhi');
  assert.strictEqual(brain.parseCity('weather today', 'Jaipur'), 'Jaipur');
  assert.strictEqual(brain.parseCity('aaj ka mausam', 'Jaipur'), 'Jaipur');
  assert.strictEqual(brain.parseCity('tell me the weather', 'Jaipur'), 'Jaipur');
  assert.strictEqual(brain.parseCity('आज का मौसम', 'Jaipur'), 'Jaipur');
  assert.strictEqual(brain.parseCity('', 'Jaipur'), 'Jaipur');
});

test('getWeather: URLs and shape', async () => {
  const fetch = mockFetch(weatherRoutes);
  const w = await brain.getWeather('Mumbai', { fetch });

  assert.strictEqual(fetch.calls.length, 2);
  assert.strictEqual(
    fetch.calls[0].url,
    'https://geocoding-api.open-meteo.com/v1/search?name=Mumbai&count=1'
  );
  const u = new URL(fetch.calls[1].url);
  assert.strictEqual(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.strictEqual(u.searchParams.get('latitude'), '19.07');
  assert.strictEqual(u.searchParams.get('longitude'), '72.88');
  assert.strictEqual(
    u.searchParams.get('current'),
    'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
  );
  assert.strictEqual(u.searchParams.get('daily'), 'temperature_2m_max,temperature_2m_min');
  assert.strictEqual(u.searchParams.get('timezone'), 'auto');

  assert.deepStrictEqual(w, {
    city: 'Mumbai',
    temp: 31,
    feels: 35,
    humidity: 70,
    wind: 12,
    code: 61,
    description: 'light rain',
    max: 33,
    min: 27,
  });
});

test('getWeather: encodes the city and rejects unknown places', async () => {
  const fetch = mockFetch([['geocoding-api.open-meteo.com', { body: {} }]]);
  await assert.rejects(brain.getWeather('New Delhi', { fetch }), /couldn't find a place called New Delhi/);
  assert.ok(fetch.calls[0].url.includes('name=New%20Delhi'));
});

test('ask: weather path speaks a sentence and never calls Anthropic', async () => {
  const fetch = mockFetch(weatherRoutes);
  const out = await brain.ask('Mumbai ka mausam', { anthropic: 'test-key', city: 'Pune' }, { fetch });
  assert.strictEqual(
    out,
    "It's 31 degrees in Mumbai, feels like 35, with light rain. Today's high is 33 and the low 27."
  );
  assert.ok(fetch.calls[0].url.includes('name=Mumbai'));
  assert.ok(fetch.calls.every((c) => !c.url.includes('anthropic.com')));
});

test('ask: weather with no city uses keys.city', async () => {
  const fetch = mockFetch(weatherRoutes);
  await brain.ask("what's the weather", { city: 'Pune' }, { fetch });
  assert.ok(fetch.calls[0].url.includes('name=Pune'));
});

test('askClaude: request shape, joins text blocks, strips markdown', async () => {
  const fetch = mockFetch([
    [
      'api.anthropic.com',
      {
        body: {
          stop_reason: 'end_turn',
          content: [
            { type: 'server_tool_use', id: 'x', name: 'web_search', input: { query: 'q' } },
            { type: 'web_search_tool_result', tool_use_id: 'x', content: [] },
            { type: 'text', text: '**India** won ' },
            { type: 'text', text: 'the match, `sir`. See [the report](https://example.com/a).' },
          ],
        },
      },
    ],
  ]);
  const out = await brain.askClaude('Who won the match?', { anthropic: 'test-key', name: 'Reyaan' }, { fetch });
  assert.strictEqual(out, 'India won the match, sir. See the report.');

  assert.strictEqual(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(init.method, 'POST');
  assert.strictEqual(init.headers['x-api-key'], 'test-key');
  assert.strictEqual(init.headers['anthropic-version'], '2023-06-01');
  assert.strictEqual(init.headers['content-type'], 'application/json');

  const body = JSON.parse(init.body);
  assert.strictEqual(body.model, 'claude-fable-5-2');
  assert.strictEqual(body.max_tokens, 1024);
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'Who won the match?' }]);
  assert.deepStrictEqual(body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
  assert.match(body.system, /Jarvis/);
  assert.match(body.system, /Reyaan/);
});

test('askClaude: keys.model overrides the default, name defaults to sir', async () => {
  const fetch = mockFetch([
    ['api.anthropic.com', { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }] } }],
  ]);
  await brain.askClaude('hi', { anthropic: 'test-key', model: 'some-other-model' }, { fetch });
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.strictEqual(body.model, 'some-other-model');
  assert.match(body.system, /for sir/);
});

test('askClaude: continues on pause_turn, at most twice', async () => {
  const paused = { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Part. ' }] };
  const fetch = mockFetch([
    [
      'api.anthropic.com',
      (n) => ({ body: n === 1 ? paused : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }),
    ],
  ]);
  const out = await brain.askClaude('q', { anthropic: 'test-key' }, { fetch });
  assert.strictEqual(out, 'Part. Done.');
  assert.strictEqual(fetch.calls.length, 2);
  const second = JSON.parse(fetch.calls[1].init.body);
  assert.deepStrictEqual(second.messages, [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: paused.content },
  ]);

  const always = mockFetch([['api.anthropic.com', { body: paused }]]);
  await brain.askClaude('q', { anthropic: 'test-key' }, { fetch: always });
  assert.strictEqual(always.calls.length, 3);
});

test('askClaude: missing key', async () => {
  const fetch = mockFetch([]);
  await assert.rejects(brain.askClaude('hi', {}, { fetch }), /No Anthropic key set/);
  await assert.rejects(brain.askClaude('hi', undefined, { fetch }), /No Anthropic key set/);
  assert.strictEqual(fetch.calls.length, 0);
});

test('askClaude: 401 throws a clear error', async () => {
  const fetch = mockFetch([
    [
      'api.anthropic.com',
      { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    ],
  ]);
  await assert.rejects(
    brain.askClaude('hi', { anthropic: 'bad-key' }, { fetch }),
    /Anthropic request failed \(401\): invalid x-api-key/
  );
});

test('ask: general question goes to Claude', async () => {
  const fetch = mockFetch([
    ['api.anthropic.com', { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Paris, sir.' }] } }],
  ]);
  const out = await brain.ask('What is the capital of France?', { anthropic: 'test-key' }, { fetch });
  assert.strictEqual(out, 'Paris, sir.');
  assert.strictEqual(fetch.calls.length, 1);
});

test('ask: mood without an Anthropic key returns the weather feel only', async () => {
  const fetch = mockFetch(weatherRoutes);
  const out = await brain.ask('aaj ka mood', { city: 'Mumbai' }, { fetch });
  assert.strictEqual(out, "It's a hot 31 degrees in Mumbai with light rain.");
  assert.ok(fetch.calls.every((c) => !c.url.includes('anthropic.com')));
});

test('ask: mood with a key sends the weather facts to Claude', async () => {
  const fetch = mockFetch([
    ...weatherRoutes,
    ['api.anthropic.com', { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Warm and upbeat, sir.' }] } }],
  ]);
  const out = await brain.ask("what's the mood", { anthropic: 'test-key', city: 'Mumbai' }, { fetch });
  assert.strictEqual(out, 'Warm and upbeat, sir.');
  const body = JSON.parse(fetch.calls[2].init.body);
  assert.match(body.messages[0].content, /31 degrees in Mumbai/);
  assert.match(body.messages[0].content, /India/);
});
