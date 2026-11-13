# Sound design recipes

In all of them, `sfx` is `node {{AUDIOFX_DIR}}/bin/sfx.mjs`. Times are examples.

## Scenes

### Hit on the cut (product reveal)

The cut to the product screen lands at 6.0 s. The riser climbs up to it, the audio empties half a second before, and the hit lands with the cut:

```bash
sfx apply mix.wav mix-hit.wav "riser:at=6,length=2.5" "drop-gap:at=5.55,gap=0.45" "hit:at=6,size=0.7" loudness
```

Process the full mix (or the music): times are absolute within the file.

### Trailer title and cut to black

```bash
sfx apply music.wav music-title.wav "braam:at=1.2" "sub-drop:at=1.2,level=-4"
sfx apply mix.wav mix-ending.wav "stop-tail:at=28.5,decay=3.5" "sub-drop:at=28.5,level=-4"
```

`stop-tail` cuts everything at `at` and lets only the reverb tail ring: ideal for the last frame before black.

### Phone call (you hear the other end)

```bash
sfx apply voice-other-end.wav call.wav voice-clean "telephone:noise=0.1"
```

The on-camera voice stays clean, without the phone. Only the other end gets `telephone`.

### A vintage radio playing in the scene that then takes over

The music starts "inside" the radio and opens up to full screen at 6 s:

```bash
sfx apply music.wav music-radio.wav "am-radio@0-6" --fade 1.2
```

### Going in and out of the water

```bash
sfx apply mix.wav mix-water.wav "underwater:depth=0.8@4.0-9.5" --fade 0.35
```

A short fade (0.2–0.4 s) gives the splash of diving in. A long one (1–2 s) gives a slow immersion.

### Explosion and shell shock

The hit goes in dry. Then everything goes dull, a ringing stays, and the world slowly comes back:

```bash
sfx apply mix.wav mix-shock.wav "tinnitus:deafness=0.85,ring=6,level=0.4@12.0-19.0" --fade 1.5
```

Make the hit land just before `from` (12.0 s in the example).

### Flashback or memory

```bash
sfx apply voice-memory.wav voice-memory-fx.wav voice-clean "flashback:amount=0.6"
sfx apply music.wav music-memory.wav "filter-sweep:fromFreq=18000,toFreq=900,start=10,duration=1.5"
```

The music closes in as the memory starts. To come back to the present, another `filter-sweep` the other way.

### Music drop

The music starts filtered and opens right on the drop cut (at 13.5 s):

```bash
sfx apply music.wav music-drop.wav "filter-sweep:fromFreq=300,toFreq=18000,start=11.5,duration=2,q=1.5"
```

For a gap before the hit, add `"drop-gap:at=13.3,gap=0.2"`.

### Comedic stop

```bash
sfx apply music.wav music-stop.wav "tape-stop:at=8.2,length=0.9"
```

The file ends at `at + length`. The silence after it is part of the joke.

### A character's voice

```bash
sfx apply voice.wav robot.wav voice-clean "robot:freq=60"
sfx apply voice.wav ghost.wav voice-clean "ghost:mix=0.6"
sfx apply voice.wav monster.wav voice-clean "monster:semitones=-9" limiter
```

### Voice-over on music (final mix)

```json
{
  "version": 1,
  "video": "cut.mp4",
  "tracks": [
    { "id": "voice", "role": "voice", "clips": [{ "file": "vo.wav", "at": 1.5, "steps": [{ "effect": "voice-clean" }, { "effect": "gate", "params": { "threshold": -40 } }] }] },
    { "id": "music", "role": "music", "gain": -6, "clips": [{ "file": "song.wav", "fadeIn": 0.5, "fadeOut": 2 }], "duck": { "depth": 12 } }
  ]
}
```

```bash
sfx mix voice-over.json final.mp4
sfx analyze final.mp4
```

- `voice-clean` first on the voice, `gate` only if it has background noise between phrases.
- Music under a voice usually sits 12–18 dB below it: the track `gain` sets the bed and `duck` takes it further down while the voice speaks.
- The master is normalized toward -14 LUFS with a -1 dB ceiling. Check it with `sfx analyze`: when the gain needed pushes peaks into the ceiling, the mix lands under the target.

## Integrations

### Python (renders with numpy and ffmpeg)

The filtergraph goes into `-af` as-is:

```python
import subprocess

SFX = ["node", "{{AUDIOFX_DIR}}/bin/sfx.mjs"]

def fx(*steps: str) -> str:
    """AudioFX filtergraph to pass to ffmpeg -af."""
    return subprocess.check_output([*SFX, "graph", *steps], text=True).strip()

PHONE = fx("voice-clean", "telephone")
voice = decode_audio(MEDIA / "voice.mov", 3.2, 2.5, PHONE)
```

- Build the filtergraph once and reuse it: it takes about 300 ms because Node starts up.
- The graph starts with `aresample=48000` and outputs stereo, compatible with `-f f32le -ac 2 -ar 48000`.
- If the helper trims with `-t` after `-i`, it also trims the reverb or echo tail. Give it a longer duration, or use `--tail 0` and accept the cut.

### Remotion

Process before rendering and reference the resulting file:

```bash
sfx apply public/voice.wav public/voice-radio.wav am-radio
```

```tsx
<Audio src={staticFile("voice-radio.wav")} />
```

For effects inside a window, use `@from-to` in seconds of the file, not frames: second = frame / fps.

### Full video

```bash
sfx apply cut.mp4 cut-final.mp4 "underwater@4-9.5" loudness --fade 0.4
```

The picture is copied without re-encoding.

## Ducking (lowering the music while the voice speaks)

`sfx mix` ducks every music track under the voice tracks, by an exact depth in dB:

```bash
sfx mix mix.wav --voice voice.wav --music music.wav --duck 12
```

- Default 10 dB. In a project, `"duck": { "depth": 12, "attack": 20, "release": 600, "threshold": -45 }` on the music track: attack and release in ms (the music is back within 1 dB `release` ms after the voice stops), threshold in dBFS RMS of the voice.
- `"duck": false` on a music track keeps it level; `"duck": true` on an sfx track ducks it too.
- Without the CLI, ffmpeg's `sidechaincompress` does the same by hand, but its depth depends on the voice's level.

## A drop on the cut, with stems

The video is 30 s with its main cut at 12.4 s; the song's drop is at 64.0 s (confirmed by the user from `sfx sections`). The drums, bass and instruments stems of the song are in the library. Each stem plays from 64 − 12.4 = 51.6 s, so the drop lands on the cut, and only the drums go underwater from 12 to 18 s:

```json
{
  "version": 1,
  "video": "cut.mp4",
  "tracks": [
    { "id": "voice", "role": "voice", "clips": [{ "file": "vo.wav", "at": 1.5, "steps": [{ "effect": "voice-clean" }] }] },
    { "id": "drums", "role": "music", "clips": [{ "file": "library:<drums id>", "start": 51.6, "length": 30, "fadeOut": 1.5 }],
      "steps": [{ "effect": "underwater", "from": 12, "to": 18, "fade": 0.35 }] },
    { "id": "bass", "role": "music", "clips": [{ "file": "library:<bass id>", "start": 51.6, "length": 30, "fadeOut": 1.5 }] },
    { "id": "instruments", "role": "music", "clips": [{ "file": "library:<instruments id>", "start": 51.6, "length": 30, "fadeOut": 1.5 }] },
    { "id": "hits", "role": "sfx", "clips": [{ "file": "door.wav", "at": 12.4, "align": "onset", "gain": -3 }] }
  ]
}
```

```bash
sfx mix drop-stems.json final.mp4
```

- The stems' clips share `start` and `length`, so together they play the full song; the `underwater` step on the drums track changes only the drums, and only inside its window (track windows are in video seconds).
- Every music track ducks under the voice by the same default depth, so the stems stay balanced against each other.
- To hear one stem alone, `"solo": true` on its track.
