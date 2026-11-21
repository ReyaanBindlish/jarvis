const test = require("node:test");
const assert = require("node:assert");
const { parseWake, toWav } = require("../src/renderer/wake.js");

test("wake: ignores speech that does not address Jarvis", () => {
  assert.equal(parseWake("what is the weather today"), null);
  assert.equal(parseWake("Thank you."), null);
  assert.equal(parseWake(""), null);
});

test("wake: the name alone wakes with no query", () => {
  assert.deepEqual(parseWake("Hey Jarvis."), { query: "" });
  assert.deepEqual(parseWake("jarvis"), { query: "" });
  assert.deepEqual(parseWake("हे जार्विस"), { query: "" });
});

test("wake: a question after the name becomes the query", () => {
  assert.deepEqual(parseWake("Hey Jarvis, what's the weather in Mumbai?"), { query: "what's the weather in Mumbai?" });
  assert.deepEqual(parseWake("So Jarvis aaj ka mausam kaisa hai"), { query: "aaj ka mausam kaisa hai" });
  assert.deepEqual(parseWake("जार्विस, आज का मौसम कैसा है"), { query: "आज का मौसम कैसा है" });
});

test("wake: wav is 16 kHz mono with a valid header", () => {
  const wav = new DataView(toWav([new Float32Array(48000).fill(0.5)], 48000));
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.byteLength, 44 + 16000 * 2);
  assert.equal(wav.getInt16(44, true), 16383);
});
