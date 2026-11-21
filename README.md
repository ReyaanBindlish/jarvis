# Jarvis

Jarvis is a mini Siri for Windows. It sits in a small notch at the top of your screen, listens when you call it, and answers out loud in English, Hindi or Hinglish. Ask it about the weather, the mood of the day, or anything else.

- Download: https://github.com/ReyaanBindlish/jarvis/releases/download/v1.0.0/Jarvis-win.zip
- Site: https://reyaanbindlish.github.io/jarvis/

## Setup

1. Download the zip, unzip it and run `Jarvis.exe`.
2. Right-click the notch and choose "Set keys". This opens `%APPDATA%\Jarvis\keys.json`.
3. Fill in your own keys and save the file.

```json
{
  "anthropic": "",
  "groq": "",
  "deepgram": "",
  "elevenlabs": "",
  "voice": "",
  "model": "",
  "city": "New Delhi",
  "name": "sir"
}
```

| Field | What it is for |
| --- | --- |
| `anthropic` | Claude answers and web search |
| `groq` | Speech to text |
| `deepgram` | Speech to text |
| `elevenlabs` | The speaking voice |
| `voice` | ElevenLabs voice id |
| `model` | Claude model id, leave empty for the default |
| `city` | Your home city for weather |
| `name` | What Jarvis calls you |

Weather works with no keys at all. Your keys stay on your machine in `keys.json` and are never part of this repository.

## Development

```
npm install
npm start
npm test
npm run dist
```

`npm start` runs the app, `npm test` runs the brain tests with no network, and `npm run dist` builds `dist\Jarvis-win.zip`.

## Credits

- Notch window and pet face adapted from Music Notch by Ritesh Roshan (MIT)
- tadashi skills: finish and onestyle
- Open-Meteo for weather
- Groq and Deepgram for speech to text
- ElevenLabs for the voice
- Claude for the answers

## License

MIT. See [LICENSE](LICENSE).
