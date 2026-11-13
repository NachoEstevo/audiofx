---
name: sound-design
description: Sound design for videos with the local AudioFX CLI (`sfx`). 62 effects as ffmpeg filtergraphs, including synthesized cinema moments anchored to a second (impact hit, riser, whoosh, sub drop, trailer braam, gap before the drop, cut with a reverb tail, reverb or echo throw, stutter, trailer voice, archival voice), recorded samples layered at an exact second (from the user's sound library such as Epidemic Sound, from ElevenLabs or from local files), mixing voice, music and effects on a timeline with the music ducked under the voice, music fitted to the video (a track cut to the video's length with its drop on the main cut, stems treated one by one) and treatments (AM radio, landline, cellphone, device speakers, walkie-talkie, old TV, vinyl, cassette, underwater, behind the wall, reverb from bathroom to cathedral, echo, far away, robot, monster, ghost, dream, flashback, post-explosion shell shock, slow motion, tape stop, filter sweeps, reverse swell, low/high pass, clean voice, LUFS normalization). Use it whenever you build, edit or mix the audio of a video (ffmpeg, Python with numpy, Remotion, launch cuts, reels, explainers), when a scene asks for something to sound "as if...", when a voice, song or effect needs treatment, when preparing a drop, a hit on a cut, a title or a sound transition, when picking or cutting music for a video, or when normalizing loudness for export, even if the request never mentions audio effects. Also for ElevenLabs voices, music or sound effects that need processing (see the elevenlabs-fx skill to generate them). También para pedidos en español: bajo el agua, radio, teléfono, golpe, riser, whoosh, braam, sample, efecto de sonido grabado, mezcla, ducking, música al largo del video, el drop en el corte, stems, LUFS.
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
| A video's length and hard cuts | `sfx cuts <video>` |
| Where a song rises (drop candidates) and falls | `sfx sections <file>` |
| Mix voice, music and effects on a timeline, the music ducked under the voice | `sfx mix <output> --voice v.wav --music m.wav [--sfx hit.wav@6] [--video cut.mp4]`, or `sfx mix project.json <output>` |
| Keep a recorded sample and layer it | `sfx sample add <file\|url> --title "..."`, `sfx sample list`, then the `layer` effect |
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

1. **Read the script or the edit and mark the moments** that need treatment: a voice coming through a phone, the camera going underwater, a memory, a drop, a comedic cut. `sfx cuts video.mp4` prints the video's length and its hard cuts (a lower `--threshold`, default 10, catches softer ones). Write the times down in seconds.
2. **Pick the effect from the table below.** When unsure, `sfx list` and `sfx describe`. Start with the defaults: they are tuned to sound clear without overdoing it.
3. **Treat each track separately, before mixing.** Era, character and space effects go on the voice or the specific effect, not on the full mix. The exception is a narrative device that affects everything you hear (underwater, shell shock, dream).
4. **Use windows for changes inside a clip** (`@from-to`) instead of cutting and splicing files.
5. **Mix and normalize at the end** with `sfx mix` (see "Mixing"): it ducks the music under the voice and normalizes the master toward -14 LUFS for social and YouTube (`--loudness -16` for podcasts, `-23` for broadcast). For a single file, `loudness` at the end of its chain does the same. Then check with `sfx analyze` that the loudness is near the target and the true peak stays at -1 dBTP or lower.
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
- Need a real recorded sound (an impact with weight, a door, glass, rain) rather than a synthesized one? Layer a sample at `T`: see the next section.

## Real samples as layers

Synthesized hits are fast and free, but a recorded impact, whoosh or foley sound usually reads as more real. The `layer` effect mixes any audio file into the signal at an exact second, inside the same filtergraph:

```bash
sfx apply mix.wav mix-door.wav "layer:file=door.wav,at=6,align=onset,level=-3"
sfx apply mix.wav mix-hit.wav "riser:at=6,length=2.5" "drop-gap:at=5.55,gap=0.45" "layer:file=library:ab12cd34ef56,at=6,align=onset" "sub-drop:at=6,level=-4"
```

- `align=onset` measures where the sample's attack is and puts **that** on `at`. Samples often start with 20–300 ms of silence or pre-roll; with the default `align=start` that silence makes the hit land late. Use `align=peak` for whooshes and swells, whose loudest point is what lands on the cut.
- `level` in dB, `length` to use only the first seconds, `fadeIn` / `fadeOut` to shape it. `sync=<s>` sets the sync point by hand (with `align=start`).
- A sample replaces the synthesized `hit`, `braam` or `whoosh`; keep the `riser`, `drop-gap` and `sub-drop` around it.
- To treat the sample itself (reverb, distance, a speaker), process it first with `sfx apply sample.wav sample-fx.wav ...` and layer the result.
- A pass-by (car, motorbike, drone): render the isolated sample through `doppler` with `at` on its closest point, then layer it with `sync` on that second so the pass lands on the cut: `sfx apply car.wav car-pass.wav "doppler:at=2,speed=90"`, then `"layer:file=car-pass.wav,at=6,sync=2"`.
- Sample levels vary a lot. After layering, run `sfx analyze` on the result and bring `level` down if the peak reaches 0 dBFS.

### Where samples live

Samples are licensed audio that belongs to the user's subscription. They live in `~/.audiofx/samples`, each with a `.json` (id, title, source, kind, stem) next to it, and **never** in a project folder or a repository:

```bash
sfx sample add <file-or-url> --title "Door slam, heavy wood" --id <library id> --source epidemic-sound
sfx sample list            # each sample's library:<id>, duration and where its attack is
```

`sample add` copies a local file or downloads a URL, measures the attack and prints the `library:<id>` reference to use in `layer:file=...`. The studio shows the samples in its *Samples* tab, and its moments can use one instead of the synthesized impact or whoosh.

### Fetching from a sound library (Epidemic Sound MCP)

When the user has the Epidemic Sound MCP connected (tools `SearchSoundEffects` and `DownloadSoundEffect`):

1. **Reuse first.** `sfx sample list`: if a fitting sample is already there, use it.
2. **Search** with `SearchSoundEffects`: a short, concrete term ("cinematic impact low", "whoosh fast short", "glass shatter"), `first: 5`, and a duration filter in milliseconds that fits the use (impacts and whooshes under 4000; ambiences longer). Choose by title, tags and duration.
3. **Download** with `DownloadSoundEffect` (`fileType: WAV`). It returns a signed URL that expires.
4. **Keep it**: `sfx sample add "<assetUrl>" --title "<title>" --id <id> --source epidemic-sound`. Never write the signed URL into a file, and never save the audio inside the project.
5. **Use it** with the `library:<id>` that `sample add` printed: `"layer:file=library:<id>,at=T,align=onset"`.

You can't listen, so don't claim a sample "sounds right". Report what you can measure (duration, where the attack is, the peak of the result) and, when the choice matters, add two or three candidates and let the user pick by ear in the studio's *Samples* tab. If a download fails with `RETRY_LATER`, wait the seconds it says before trying again.

## Mixing: `sfx mix`

`sfx mix` lays voice, music and effect clips on one timeline, ducks the music under the voice and normalizes the master, in one ffmpeg pass. The quick form takes one flag per clip, `file@second`:

```bash
sfx mix final.mp4 --video cut.mp4 --voice vo.wav@1.5 --music library:<id> --sfx door.wav@7.52
sfx mix final.wav --voice vo.wav --music song.wav --duck 14 --loudness -16
sfx mix --video cut.mp4 --voice vo.wav@1.5 --music song.wav --print > mix.json
```

- The music goes down 10 dB while a voice plays (`--duck <dB>`, `--no-duck`). An `--sfx` clip's attack lands on its second, like `align=onset`.
- The master is normalized toward -14 LUFS (`--loudness <LUFS|off>`), then a -1 dB ceiling. Measure the result with `sfx analyze`: on a mix with a wide loudness range the one-pass normalization can land several LU under the target (raise `--loudness` by the shortfall and mix again), and a video's AAC audio can peak about 0.3 dB over the ceiling (`"master": { "ceiling": -1.5 }` keeps it at -1 dBTP).
- The mix lasts `--duration`, else the video's length, else up to the end of the last clip. With `--video` and a video output, the picture is copied and the audio replaced.
- `--print` writes the project JSON instead of rendering: edit it, then `sfx mix mix.json final.mp4`.

A project file gives each clip and track its own settings. Paths are relative to the project file, and `library:<id>` works wherever a file does:

```json
{
  "version": 1,
  "video": "cut.mp4",
  "tracks": [
    { "id": "voice", "role": "voice", "clips": [{ "file": "vo.wav", "at": 1.5, "steps": [{ "effect": "voice-clean" }] }] },
    { "id": "music", "role": "music", "clips": [{ "file": "library:<id>", "fadeOut": 2 }], "duck": { "depth": 12, "release": 600 } },
    { "id": "hits", "role": "sfx", "clips": [{ "file": "door.wav", "at": 7.52, "align": "onset", "gain": -3 }] }
  ],
  "master": { "loudness": -14 }
}
```

- **Clip**: `file`, `at` (timeline second), `start` and `length` (the stretch of the file to use), `gain` (dB), `fadeIn`, `fadeOut`, `align` (`start`, `onset`, `peak`), `steps`.
- **Track**: `id`, `role` (`voice`, `music`, `sfx`), `gain`, `mute`, `solo`, `steps`, `duck` (`true`, `false` or `{ depth, attack, release, threshold }`; on by default for music).
- **Step**: `{ "effect": "underwater", "params": { "depth": 0.8 }, "from": 4, "to": 9.5, "fade": 0.35 }`. Clip steps run in clip time (0 = the clip's start); track steps run in timeline time, so their windows line up with the video.
- **Master**: `steps`, `loudness` (`null` leaves the level as mixed), `ceiling` (dB, default -1).

## Music fitted to the video

The goal is a track cut to the video's exact length, with its drop on the video's main cut. You can't hear which rise is "the" drop: measure, propose with numbers, and let the user confirm by ear. With the Epidemic Sound MCP (`SearchRecordings`, `DownloadRecording`, `EditRecording`, `PollEditRecordingJob`, `DownloadRecordingEdit`):

1. **Measure the video.** `sfx cuts cut.mp4` prints its length (say 30.000 s) and its hard cuts. Agree with the user on the main cut `C` where the drop must land (say 12.4 s).
2. **Find and keep a track.** `SearchRecordings` with `query: { term: "..." }`, a `filter` (`bpm: {min,max}`, `duration: {min,max}` in ms, `moodSlugs`, `taxonomySlugs` for genre, `vocals: false` for music under a voice) and `first: 5`. Shortlist two or three by `title`, `bpm` and `audioFile.durationInMilliseconds`; the user can hear each one's `audioFile.lqmp3Url`. Download the pick with `DownloadRecording` (`id`, `options: { fileType: "WAV", stemType: "FULL" }`) and keep it at once, since its `assetUrl` expires:
   ```bash
   sfx sample add "<assetUrl>" --title "<title>" --id <id> --source epidemic-sound --kind music
   ```
   It prints the `library:<id>` reference used from here on (not the Epidemic id).
3. **Find the drop candidates.** `sfx sections library:<id>` lists the strongest rises with their jump in dB, overall and below 150 Hz (a drop is where kick and bass enter), the falls and the sections. A `~` marks a gradual change whose time is approximate. Propose the top two or three with their numbers ("64.000 s, +8.6 dB, low band +30.2 dB") and ask the user to confirm the drop by ear, in the studio or the preview. Don't choose it yourself. Call the confirmed second `D`.
4. **Cut the track.** Call `EditRecording` with the recording's `id` and:
   ```json
   { "targetDurationMs": 30000, "downloadAudioFormat": "WAV", "forceDuration": true,
     "requiredRegionsAtOffsets": [{ "startMs": 56000, "endMs": 72000, "offsetMsInEdit": 4400 }] }
   ```
   `targetDurationMs` is the video's length (max 300000). The required region keeps `lead` seconds of build-up before the drop and `hold` seconds after it, and places them so the drop lands on `C`: `startMs = D − lead`, `endMs = D + hold`, `offsetMsInEdit = C − lead`, in ms. Above, `D` = 64, `C` = 12.4, `lead` = `hold` = 8: the region 56–72 s starts at 4.4 s in the edit, so the drop plays at 4.4 + 8 = 12.4 s. It needs `C − lead ≥ 0` and `C + hold ≤` the video's length: shorten `lead` or `hold` until both hold. The call returns a job `{ id, status }`. Poll it with `PollEditRecordingJob` (`id`), waiting 5–10 s between polls, until `COMPLETED` (on `FAILED`, tell the user). Then `DownloadRecordingEdit` (`input: { jobId, editId }`, with the poll's `edit.id`) and keep its `assetUrl` with `sfx sample add ... --kind music --id <edit.id>`: an id of its own, since the recording's id would replace the full track.
5. **Verify by measurement, not by ear.** `sfx sections library:<edit id>` must show the top rise at `C` (within a few tens of ms) and a duration equal to the video's (`sfx analyze` gives it too). If not, say so and adjust the region; don't hand it over as fitted.
6. **Mix** with `sfx mix` (see above): the voice, the edit on a music track (ducked) and the effects.

Licensed audio stays in the library (`sfx sample add`), never in the project folder or a repository; projects refer to it as `library:<id>`. Never write a signed `assetUrl` into a file. If a download returns `RETRY_LATER`, wait its `retryAfterSeconds`.

### Stems: treating one part of the song

To put only the drums underwater, download the `DRUMS`, `BASS` and `INSTRUMENTS` stems of the same recording (`DownloadRecording` with that `stemType`; the search result's `stems[].type` says which exist) and keep each one with `--stem`:

```bash
sfx sample add "<assetUrl>" --title "<title>" --id <id> --source epidemic-sound --kind music --stem drums
```

An id + stem pair is one sample, listed as "Title · drums". Give each stem its own music track with the same `at`, `start` and `length`: together they are the full song, and a step on one track treats only that stem.

```json
{ "id": "drums", "role": "music", "clips": [{ "file": "library:<drums id>", "start": 51.6, "length": 30 }],
  "steps": [{ "effect": "underwater", "from": 12, "to": 18, "fade": 0.35 }] },
{ "id": "bass", "role": "music", "clips": [{ "file": "library:<bass id>", "start": 51.6, "length": 30 }] },
{ "id": "instruments", "role": "music", "clips": [{ "file": "library:<instruments id>", "start": 51.6, "length": 30 }] }
```

These stems are of the original recording, not of the edit. `EditRecording` with `skipStems: false` makes stems of the edit, but `DownloadRecordingEdit` as described here returns only the edit's full mix, so check what your Epidemic tools actually return before assuming either way. With stems of the original, place a stretch of the uncut song instead of the edit: `start = D − C` puts the drop on the cut (above, 64 − 12.4 = 51.6) and `length` is the video's length; when `D < C`, use `"at": C − D` and no `start`. Check in `sfx sample list` that the stems have the same duration before stacking them.

## Which effect to use

| The scene needs… | Effect | Starting point |
| --- | --- | --- |
| Cut, reveal, on-screen hit | `hit` | `at=<s>,size=0.6,tone=mid` |
| A recorded sound on a cut (impact, door, glass, whoosh) | `layer` | `file=<path or library:id>,at=<s>,align=onset` |
| Tension rising to a cut | `riser` | `at=<s of the cut>,length=2.5` |
| Something flying past the screen | `whoosh` | `at=<s>,direction=left-right` |
| A car, train or plane passing the camera | `doppler` | `at=<s of the pass>,speed=90`, on the isolated sound, then `layer` it |
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
| Steady hiss, fan or room noise under dialogue | `denoise` | `reduction=12`; before `voice-clean` |
| Harsh "s" sounds | `de-esser` | `amount=0.6,freq=4000`; after `voice-clean`, at the voice's final level |
| Noise between phrases in a home recording | `gate` | `threshold=-40` |
| Pushing the music to the background | `lowpass` + `gain` | `freq=1200`, `db=-8` |
| Export | `loudness` | `target=-14,truePeak=-1` |

For full chains per scene type (call, flashback, explosion, drop), mix projects (voice-over on music, a drop on the cut with stems) and integration with Python and Remotion, read [references/recipes.md](references/recipes.md).

## Chain order

Cleanup → character → space → dynamics → loudness.

```bash
sfx apply voice.wav voice-final.wav voice-clean am-radio "reverb:space=room,mix=0.15" loudness
sfx apply dialogue.wav dialogue-clean.wav denoise voice-clean de-esser
```

- `voice-clean` and `gate` go first: clean before coloring. A noisy dialogue starts with `denoise`; `de-esser` follows `voice-clean`, because its detector follows the level.
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
