---
name: sound-design
description: Sound design for videos with the local AudioFX CLI (`sfx`). 61 effects as ffmpeg filtergraphs, including synthesized cinema moments anchored to a second (impact hit, riser, whoosh, sub drop, trailer braam, gap before the drop, cut with a reverb tail, reverb or echo throw, stutter, trailer voice, archival voice) and treatments (AM radio, landline, cellphone, device speakers, walkie-talkie, old TV, vinyl, cassette, underwater, behind the wall, reverb from bathroom to cathedral, echo, far away, robot, monster, ghost, dream, flashback, post-explosion shell shock, slow motion, tape stop, filter sweeps, reverse swell, low/high pass, clean voice, LUFS normalization). Use it whenever you build, edit or mix the audio of a video (ffmpeg, Python with numpy, Remotion, launch cuts, reels, explainers), when a scene asks for something to sound "as if...", when a voice, song or effect needs treatment, when preparing a drop, a hit on a cut, a title or a sound transition, or when normalizing loudness for export, even if the request never mentions audio effects. Also for ElevenLabs voices, music or sound effects that need processing (see the elevenlabs-fx skill to generate them). También para pedidos en español: bajo el agua, radio, teléfono, golpe, riser, whoosh, braam, LUFS.
---

# Sound design with AudioFX

AudioFX turns sound design effects into **ffmpeg filtergraphs**. Each effect is a string that goes straight into `ffmpeg -af`, or is applied to a file with the CLI. What you hear in the web studio is exactly what comes out of the render.

## Command

Throughout this document, `sfx` means:

```bash
node {{AUDIOFX_DIR}}/bin/sfx.mjs
```

If `sfx` is not a command on this machine, use the full path. It works from any folder. If it fails because of ffmpeg, run `sfx doctor`.

| You need | Command |
| --- | --- |
| The catalog | `sfx list` (or `--json`) |
| Params, ranges and when to use an effect | `sfx describe <effect>` |
| Process an audio or video file | `sfx apply <input> <output> <step...>` |
| The filtergraph for your own ffmpeg | `sfx graph <step...>` |
| Measure loudness and peaks | `sfx analyze <file>` |
| A new voice, sound or song, already processed | `sfx generate <sfx\|voice\|music> "<prompt>" <output> [step...]` (ElevenLabs; see the elevenlabs-fx skill) |
| Let the user listen and tweak | `sfx studio` (opens http://127.0.0.1:5177) |

A step is written `effect[:param=value,param=value][@from-to]`:

```bash
sfx apply voice.wav voice-phone.wav telephone
sfx apply clip.mp4 clip-fx.mp4 "underwater:depth=0.8@3.2-7" --fade 0.4
sfx graph "reverb:space=cathedral,mix=0.4" "fade:in=0,out=2"
```

- Steps run in order.
- `@3.2-7` limits the effect to that window, with a `--fade` second crossfade (0.25 by default) between the dry and processed signal. `@3.2-` means from 3.2 s to the end.
- If the output is `.mp4`, `.mov`, `.mkv` or `.webm`, the picture is copied without re-encoding and the audio is replaced.
- If you get a param wrong, the CLI lists the valid ones. Don't guess: run `sfx describe`.

## Workflow

1. **Read the script or the edit and mark the moments** that need treatment: a voice coming through a phone, the camera going underwater, a memory, a drop, a comedic cut. Write the times down in seconds.
2. **Pick the effect from the table below.** When unsure, `sfx list` and `sfx describe`. Start with the defaults: they are tuned to sound clear without overdoing it.
3. **Treat each track separately, before mixing.** Era, character and space effects go on the voice or the specific effect, not on the full mix. The exception is a narrative device that affects everything you hear (underwater, shell shock, dream).
4. **Use windows for changes inside a clip** (`@from-to`) instead of cutting and splicing files.
5. **Normalize the mix at the end**: `loudness` at -14 LUFS for social and YouTube, -16 for podcasts, -23 for broadcast. Then check with `sfx analyze` that the true peak stays at -1 dBTP or lower.
6. **You can't listen.** Say which effects you applied and at what times, and offer `sfx studio` so the user can tune them by ear. If they send back new values, the studio gives them the exact command to copy.

## Cinema moments: what sells a cut

Launch videos don't sound "cinematic" because of a filter on the voice, but because of **elements placed at the right instant**: a riser climbing to the cut, a gap of silence and a hit with sub when the product appears. These effects synthesize those elements inside the same filtergraph (no licensed samples) and are anchored with `at=<second>`:

| Moment | Chain (the cut at `T`) |
| --- | --- |
| Hit on the cut, product reveal | `"riser:at=T,length=2.5" "drop-gap:at=T-0.45,gap=0.45" "hit:at=T"` |
| Title or logo | `"braam:at=T" "sub-drop:at=T,level=-4"` |
| Text or UI flying in | `"whoosh:at=T,length=0.8"` (peak at `T`) |
| Cut to black | `"stop-tail:at=T,decay=3.5" "sub-drop:at=T,level=-4"` |
| Punctuating a word | `"throw:at=T,kind=echo"` on the voice |
| Tech glitch | `"stutter:at=T,slice=0.12,repeats=4"` (lengthens the audio) |

- `at` is the second of the cut in the file you are processing. For `riser` it is where it **ends**; for `whoosh`, where it peaks; for `drop-gap`, where the gap **starts**.
- Adjust the level with `level` (dB) before touching `gain`: `hit` and `sub-drop` already come in loud.
- Few and precise: one or two moments per 15 s. A hit on every cut gets tiring.
- `trailer-voice` (deep, epic voice with a room) and `archival` (archival interview) are voice treatments, with no `at`.
- Need a real recorded-sounding effect (a door, glass, rain) rather than a synthesized one? Generate it with ElevenLabs and layer it at `T` (elevenlabs-fx skill).

## Which effect to use

| The scene needs… | Effect | Starting point |
| --- | --- | --- |
| Cut, reveal, on-screen hit | `hit` | `at=<s>,size=0.6,tone=mid` |
| Tension rising to a cut | `riser` | `at=<s of the cut>,length=2.5` |
| Something flying past the screen | `whoosh` | `at=<s>,direction=left-right` |
| Low weight under a title or hit | `sub-drop` | `at=<s>,level=-4` |
| Trailer title, epic logo | `braam` | `at=<s>,length=3.5` |
| A moment of silence before the drop | `drop-gap` | `at=<s>,gap=0.45` |
| Cut to black with a tail | `stop-tail` | `at=<s>,kind=reverb` |
| Echo or reverb only on the last word | `throw` | `at=<s>,kind=echo` |
| Trailer voice-over | `trailer-voice` | `depth=-2` |
| Archival interview | `archival` | `age=0.6` |
| Voice on the other end of a landline call | `telephone` | default (`noise=0.15,drive=3`) |
| Cellphone call, bad signal, video call | `cellphone` | `signal=0.5`; higher = more dropouts |
| Sound coming out of a device in the scene (laptop, TV, PA, earpiece) | `speaker` | `model=earpiece/phone/laptop/radio/tv/walkie/megaphone/pa` |
| Vintage radio, newscast, music from a radio in the scene | `am-radio` | `drive=6,noise=0.4,drift=0.3` |
| Police, military, pilots, radio orders | `walkie-talkie` | `drive=12` |
| A tube TV on, 70s archive | `old-tv` | `mains=50` (Europe, Argentina) or `60` (US) |
| Loudspeaker announcement, protest | `megaphone` | default |
| Warm nostalgia, record | `vinyl` | `dust=0.5,scratch=0.3,wear=0.4`; `rpm=78` for something older |
| 1900–1930 archive, silent film | `phonograph` | default |
| 80s/90s home video, VHS, mixtape | `cassette` | `wobble=0.5,age=0.4`; `loss=0.6` for worn tape |
| Lo-fi or degraded digital look | `lofi`, `8bit` | default |
| Underwater camera, fainting, being stunned | `underwater` | window with `--fade 0.4` |
| Party behind the door, neighbors | `muffled` | `thickness=0.6` |
| Someone shouting from far away, a siren blocks away | `distance` | `distance=0.6` |
| Placing a voice in a space | `reverb` | `space=bathroom/room/studio/hall/cathedral/cave/stadium` |
| End of a line, mountain echo | `echo` | `time=320,repeats=4` |
| Hallway or alley | `slapback` | default |
| Explosion: the world goes dull and a ringing stays | `tinnitus` | long window with `--fade 1.5` so the sound comes back |
| Dream or fantasy sequence | `dream` | `amount=0.6` |
| Memory, a voice from the past | `flashback` | `amount=0.6` |
| Slow-motion impact | `slowmo` | `speed=0.6` (changes the duration) |
| Abrupt comedic stop, "wait, what?" | `tape-stop` | `at=<second>,length=1` (the audio ends there) |
| Music build-up or drop | `filter-sweep` | `fromFreq=250,toFreq=18000,start=<s>,duration=<s>` |
| Music closing in as a memory starts | `filter-sweep` | `fromFreq=18000,toFreq=400` |
| Ghostly entrance, inhale before a sound | `reverse-swell` | `decay=1.5` (adds time before) |
| Robot, AI, system | `robot` | `freq=60` |
| Creature, demon | `monster` | `semitones=-8` |
| Talking pet, comedy | `chipmunk` | `semitones=8` |
| Ghost, voice from beyond | `ghost` | `mix=0.6` |
| Alien, unknown transmission | `alien` | `shift=140` |
| Narration or interview before mixing | `voice-clean` | default; almost always the first step for a voice |
| Noise between phrases in a home recording | `gate` | `threshold=-40` |
| Pushing the music to the background | `lowpass` + `gain` | `freq=1200`, `db=-8` |
| Export | `loudness` | `target=-14,truePeak=-1` |

For full chains per scene type (call, flashback, explosion, drop) and integration with Python, Remotion and ducking, read [references/recipes.md](references/recipes.md).

## Chain order

Cleanup → character → space → dynamics → loudness.

```bash
sfx apply voice.wav voice-final.wav voice-clean am-radio "reverb:space=room,mix=0.15" loudness
```

- `voice-clean` and `gate` go first: clean before coloring.
- Era or character effects go before the reverb: a radio sounds in a room, not the other way around.
- `loudness` and `limiter` always go last.
- Don't stack two reverbs. If a voice already has a space, don't add another.

## Rules that prevent mistakes

- **Tails.** `reverb`, `echo`, `slapback`, `distance`, `ghost`, `dream` and `flashback` add 3 s of silence at the end so the tail is not cut (`--tail <s>`, `--tail 0` to add none). With video outputs the audio is trimmed to the picture length.
- **Trimming with `-t`.** If you later load the file with a helper that trims with `-t` as an output option (for example `decode_audio(path, start, duration, FX)`), the tail is lost. Ask for a longer duration or apply the effect to the clip once it is placed.
- **Sync.** The sound onset never shifts more than one frame at 24 fps, so you can place the result at the same instant as the original. The exceptions are the effects that change the duration: `slowmo`, `speedup`, `tape-stop`, `reverse`, `reverse-swell` and `stutter`. Those don't accept `@from-to`: trim the clip first (`--start`, `--duration`) and process it whole. `reverse-swell` adds `decay` seconds before the sound, so place it `decay` seconds earlier.
- **Levels.** Most effects stay within a few dB of the source. Some change it on purpose: `distance` (about -10 LU), `muffled` (about -8 LU) and `tinnitus` lower it, `bandpass` loses whatever falls outside the band, and `monster` raises it slightly. Measure with `sfx analyze` before mixing. If the output reaches 0 dBFS, add `limiter` at the end: by default it is a -1 dB safety ceiling that does not raise the level (`limiter:drive=6` makes things louder and denser).
- **Mastered sources.** Commercial music often peaks at -0.1 dBTP. Distortion, bit crushing and modulation (`lofi`, `8bit`, `vibrato`, `alien`) can push it over 0 dBTP: finish those chains with `limiter` or `loudness`.
- **Reproducibility.** Noise, crackle and reverbs use a seed. With the same chain and the same `--seed`, the result is byte-identical. Change the seed if the same crackle repeats in two nearby clips.
- **Don't invent effects.** If something is not in `sfx list`, say so and build it with ffmpeg filters by hand, or propose adding it to the catalog in `{{AUDIOFX_DIR}}/src/core/effects/`.
