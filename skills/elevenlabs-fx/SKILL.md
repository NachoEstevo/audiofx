---
name: elevenlabs-fx
description: Generate sound effects, voices (TTS) and music with ElevenLabs and run them through AudioFX effects in one step (`sfx generate`), or reuse ElevenLabs audio from the MCP or the user's account. Covers connecting (API key, hosted MCP for Claude and Claude Code, official ElevenLabs skills), prompting sound effects, and recipes like a TTS voice through a phone or radio, a generated song that goes underwater at a moment, a door slam or whoosh layered at a cut, a seamless ambience bed, and trailer voice-overs. Use it whenever a video needs a sound, voice or music that doesn't exist yet, when the user mentions ElevenLabs, TTS, text to speech, voice-over, AI voice, AI music or AI sound effects, or when audio generated with ElevenLabs needs a filter. También en español: generar voz, locución, efecto de sonido o música con ElevenLabs.
---

# ElevenLabs + AudioFX

ElevenLabs makes the raw material (a sound effect from a prompt, a voice from text, a song); AudioFX makes it fit the scene (phone, radio, underwater, reverb, a hit on the cut). `sfx` is `node {{AUDIOFX_DIR}}/bin/sfx.mjs` (see the sound-design skill for the full effect catalog).

## 1. Check the connection

```bash
sfx doctor
```

The last line says whether an ElevenLabs key was found and where (it never prints the key). The CLI and the studio look for `ELEVENLABS_API_KEY` in the environment, then in `.env` in the current folder, the AudioFX repo, and `~/.audiofx/.env`.

If there is no key, tell the user how to connect. **Never ask them to paste the key into the chat**, and never write it into a file yourself:

1. Create an API key at https://elevenlabs.io/app/settings/api-keys (any plan; the free tier works for sound effects and premade voices).
2. Either run `npx -y @elevenlabs/cli@latest onboard init` in the project (it writes a `.env`), or add `ELEVENLABS_API_KEY=...` to `~/.audiofx/.env` themselves.
3. Run `sfx doctor` again. No restart needed.

### Other ways to connect (optional)

- **Hosted MCP**, so Claude can call ElevenLabs tools directly. In Claude (web or desktop): Settings → Connectors → add a custom connector with `https://api.elevenlabs.io/v1/mcp` and sign in. In Claude Code: `claude mcp add --transport http elevenlabs https://api.elevenlabs.io/v1/mcp`, then `/mcp` to authenticate. The directory version of the connector is restricted and may not offer music.
- **Official skills** with ElevenLabs API know-how (TTS, sound effects, music, agents): `npx skills add elevenlabs/skills`.

`sfx generate` is the most direct path for video work: it generates, saves a copy for reuse and applies effects in one command, with no MCP needed.

## 2. Generate and process in one step

```bash
sfx generate <sfx|voice|music> "<prompt>" <output> [step...]
```

| Kind | What it calls | Options |
| --- | --- | --- |
| `sfx` | Sound effects (`eleven_text_to_sound_v3`) | `--duration 0.5–30` (default: the model decides), `--loop`, `--influence 0–1` (default 0.3) |
| `voice` | Text to speech (`eleven_v4`) | `--voice <id>` (default George, a premade voice), `--model <id>` |
| `music` | Music | `--duration 3–600`, `--instrumental` |

- The chain is validated **before** spending credits, so a typo in a step fails for free.
- Every generation is also saved as `~/.audiofx/generated/<kind>-<prompt>-<time>.mp3` with a `.json` of the prompt. It shows up first in the studio library ("Generated"), so the user can try other effects on it without paying twice. Reuse it with `sfx apply` instead of generating again.
- Without steps, the raw generation is written to the output (mp3 copied; other formats converted to 48 kHz).
- `402 paid_plan_required` on a voice means a Voice Library voice: use a premade voice id or ask the user to upgrade. `429` means rate limit: wait and retry once.

## 3. Recipes

### A TTS voice through a phone, radio or device

```bash
sfx generate voice "Hey, it's me. I'm outside, open the door." call.wav voice-clean "telephone:noise=0.1"
sfx generate voice "This is your captain speaking." captain.wav "speaker:model=pa" "reverb:space=hall,mix=0.2"
sfx generate voice "Unit four, respond." radio.wav "walkie-talkie:drive=12"
```

TTS voices are clean and close: a treatment makes them belong to the scene. For a voice-over that should stay in front, use `voice-clean` and `loudness` only, or `trailer-voice` for an epic read.

### A generated song that goes underwater at a moment

The camera dives at 12 s and surfaces at 18 s:

```bash
sfx generate music "Upbeat indie pop, bright guitars, 120 bpm" song.wav "underwater:depth=0.8@12-18" --duration 30 --instrumental --fade 0.35
```

Other moment-based treatments on a song: `"am-radio@0-8" --fade 1.2` (plays from a radio, then opens up), `"filter-sweep:fromFreq=300,toFreq=18000,start=10,duration=2"` (build-up to a drop at 12 s), `"tape-stop:at=20,length=0.9"` (comedic stop).

### A sound effect layered at a cut

Generate the effect, then mix it into the video's audio at the cut (here 6.0 s) with the `layer` effect:

```bash
sfx generate sfx "Heavy wooden door slams in a stone hallway" door.wav "reverb:space=hall,mix=0.25" --duration 2
sfx apply mix.wav mix-door.wav "layer:file=door.wav,at=6,align=onset,level=-3"
```

`align=onset` measures where the generated sound's attack is and lands that on the cut, so leading silence in the generation does not make it late. Generated sound effects also show up in the studio's *Samples* tab, where the user can try them on a moment by ear. For a synthesized hit, riser or whoosh, the cinema effects in the sound-design skill are faster and free; for recorded samples from a sound library, see "Real samples as layers" there.

### An ambience bed

```bash
sfx generate sfx "Light rain on a window, distant city traffic, no thunder" rain.wav "muffled:thickness=0.4" --duration 20 --loop
```

`--loop` makes the end meet the start, so the bed can repeat under a long scene (`-stream_loop` in ffmpeg, or `<Loop>` in Remotion).

### Reusing what the user already generated

Audio the user made in the ElevenLabs app, or with the MCP, is just a file: `sfx apply <file> <output> <steps...>`. Links the hosted MCP returns (on elevenlabsusercontent.com) expire after about two hours, so download the file first, then process the local copy.

## Prompting sound effects

- Describe the source, the action, the material and the space: "glass bottle shatters on a concrete floor, small room" beats "glass breaking".
- One event per generation. Layer several generations instead of asking for a whole scene.
- Ask for what you'll process anyway in a neutral version: generate a clean "phone ringing" and add `speaker:model=phone` or `distance` with AudioFX, so the same file serves several scenes.
- Short effects (hits, clicks, whooshes) work best with `--duration 1–3`; ambiences and beds with `--loop` and 10–30 s.
- `--influence` close to 1 follows the prompt literally; lower values let the model fill in.

## Cost and care

- Each `sfx generate` call spends the user's ElevenLabs credits. Generate once, reuse the saved file, and change effects with `sfx apply` or in the studio.
- Don't loop generations to "pick the best one" without asking: offer two or three variations and let the user choose by ear in `sfx studio`.
- Generated voices must not imitate a real person without their consent.
