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

1. Voice: `voice-clean`, and `gate` if it has background noise.
2. Music: duck it (see below) or lower it with `gain`. Background music under a voice usually sits 12–18 dB below the voice.
3. Mix: `loudness` at -14 LUFS and check with `sfx analyze`.

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

Not a catalog effect yet, because it needs two inputs. Do it directly with ffmpeg:

```bash
ffmpeg -i music.wav -i voice.wav -filter_complex "[1:a]apad,asplit=2[sc][v];[0:a][sc]sidechaincompress=threshold=0.01:ratio=20:attack=5:release=300[duck];[duck][v]amix=inputs=2:duration=first:normalize=0[out]" -map "[out]" mix.wav
```

- With `threshold=0.01` the music drops about 8 dB while the voice plays. With `threshold=0.003`, about 18 dB. Measured with a voice at -13 dBFS RMS; quieter voices duck less.
- `apad` on the voice keeps the mix from ending when the voice finishes before the music.
- `release=300` brings the music back in 0.3 s. Raise it to 600–800 for a slower return.
- Measure the result with `sfx analyze` and normalize the mix with `sfx apply mix.wav final.wav loudness`.
