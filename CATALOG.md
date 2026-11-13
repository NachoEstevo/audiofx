# Effect catalog

<!-- Generated with `pnpm catalog`. Do not edit by hand: the source is src/core/effects. -->

65 effects. CLI step format: `effect:param=value,param=value@from-to`. Effects marked _at a moment_ are anchored with `at=<seconds>`.

## Cinema & trailer

### `hit` — Hit (impact) _(at a moment, adds tail)_

A trailer impact at a moment: a sub that falls in pitch, body, a crack and a big-room tail.

**When:** On a cut, a big word landing, the logo, the product reveal or the drop. Pair it with a riser (before) and drop-gap so the hit lands harder.

| Param | Default | Range |
| --- | --- | --- |
| `at` Moment | 2 | 0–600 s |
| `size` Size | 0.6 | 0–1 |
| `tone` Color | mid | dark, mid, bright |
| `level` Level | 0 | -40–6 dB |

### `riser` — Riser _(at a moment, adds tail)_

A tension build that stops dead at the given moment: noise that opens up and tones that rise an octave.

**When:** Before a hit, a drop or the product reveal. End it on the same `at` as the hit. 2–4 s for a cut; 6–10 s for a trailer build-up.

| Param | Default | Range |
| --- | --- | --- |
| `at` Ends at | 3 | 0–600 s |
| `length` Length | 2.5 | 0.5–10 s |
| `tonal` Tones | 0.6 | 0–1 |
| `level` Level | 0 | -40–6 dB |

### `whoosh` — Whoosh _(at a moment, adds tail)_

A fast pass of air that crosses the stereo field, peaking at the given moment.

**When:** Shot transitions, text or cards flying in or out, screen changes in a product demo, swipes and zooms.

| Param | Default | Range |
| --- | --- | --- |
| `at` Peak at | 1.5 | 0–600 s |
| `length` Length | 0.9 | 0.2–3 s |
| `direction` Direction | left-right | left-right, right-left, center |
| `level` Level | 0 | -40–6 dB |

### `sub-drop` — Sub drop _(at a moment, adds tail)_

A low tone that falls in pitch and fades slowly: physical weight under a hit or a cut to black.

**When:** Under a hit, on a cut to black, when a big title appears or when the music stops suddenly. Felt more than heard.

| Param | Default | Range |
| --- | --- | --- |
| `at` Moment | 2 | 0–600 s |
| `length` Length | 2.5 | 1–6 s |
| `level` Level | 0 | -40–6 dB |

### `braam` — Braam _(at a moment, adds tail)_

A low blast of saturated brass that opens and fades, the signature of epic trailers.

**When:** Reveals, trailer titles, the most dramatic moment of a launch. Use it sparingly: one or two per piece.

| Param | Default | Range |
| --- | --- | --- |
| `at` Moment | 1 | 0–600 s |
| `length` Length | 3.5 | 1.5–8 s |
| `level` Level | 0 | -40–6 dB |

### `drop-gap` — Gap before the hit _(at a moment)_

Everything closes down and goes quiet just before, then slams back at the given moment.

**When:** Half a second before a hit, the music drop or the product reveal: the silence makes the hit land twice as hard. Put it on the same `at` as the hit.

| Param | Default | Range |
| --- | --- | --- |
| `at` Returns at | 2 | 0–600 s |
| `gap` Gap length | 0.45 | 0.1–2 s |
| `depth` Silence | 1 | 0–1 |

### `stop-tail` — Cut with tail _(at a moment, adds tail)_

The signal cuts dead at the given moment and only the reverb or echo tail of the last sound remains.

**When:** Cutting the music to black, the end of a video, the dramatic silence before a key line, a 'stop' on a title.

| Param | Default | Range |
| --- | --- | --- |
| `at` Cuts at | 2 | 0–600 s |
| `kind` Tail | reverb | reverb, echo |
| `decay` Tail length | 3.5 | 1–8 s |

### `throw` — Reverb throw _(at a moment, adds tail)_

Sends only a short stretch (a word, a hit) to a big reverb or echo; the rest stays dry.

**When:** Emphasize the last word of a line, the product name, a 'now' or a drum hit, without washing out the whole voice.

| Param | Default | Range |
| --- | --- | --- |
| `at` From | 1 | 0–600 s |
| `length` Length | 0.6 | 0.1–3 s |
| `kind` Type | reverb | reverb, echo |
| `amount` Amount | 0.7 | 0–1 |

### `stutter` — Stutter (glitch) _(at a moment, changes duration)_

Repeats a short slice several times in a row, like an editing glitch. Lengthens the audio by the repeats.

**When:** Big words slamming on screen, fast cuts in a tech demo, a system 'error', comedic tags.

| Param | Default | Range |
| --- | --- | --- |
| `at` Moment | 1 | 0–600 s |
| `slice` Slice | 0.12 | 0.03–0.5 s |
| `repeats` Repeats | 4 | 2–16 |

### `trailer-voice` — Trailer voice _(adds tail)_

A deeper voice with chest, compressed and saturated, forward in the mix with a big room behind it.

**When:** Trailer or launch narration, the closing claim, 'in a world where...'. Start from a clean, dry voice.

| Param | Default | Range |
| --- | --- | --- |
| `depth` Deeper | -2 | -6–0 st |
| `weight` Weight | 0.7 | 0–1 |
| `space` Room | 0.35 | 0–1 |

### `archival` — Archival voice

An old interview or speech recording: mono, narrowed band, wobbly tape, hiss and a small room.

**When:** Archive quotes (an 80s interview, a historic speech), testimonies from the past, period material inside a launch.

| Param | Default | Range |
| --- | --- | --- |
| `age` Age | 0.6 | 0–1 |
| `noise` Hiss | 0.4 | 0–1 |

### `layer` — Sample layer _(at a moment, adds tail)_

Mixes an audio file (a recorded sample, a generation, any local file) into the signal at an exact second.

**When:** When a recorded sound beats a synthesized one: a real impact on the cut, a door, glass, a whoosh, an ambience bed. Use align=onset so the sample's attack, not its leading silence, lands on `at`.

| Param | Default | Range |
| --- | --- | --- |
| `file` Sample | (required) | a path, or `library:<id>` |
| `at` Moment | 1 | 0–600 s |
| `level` Level | 0 | -60–12 dB |
| `align` Align | start | start, onset, peak |
| `sync` Sync point | 0 | 0–600 s |
| `length` Length | 0 | 0–600 s |
| `fadeIn` Fade in | 0 | 0–10 s |
| `fadeOut` Fade out | 0 | 0–10 s |

## Filters & EQ

### `lowpass` — Low pass

Lets the lows through and cuts the highs above the cutoff frequency.

**When:** To dull a sound, push music into the background, fake something behind a door, or set up a drop (filter, then open).

| Param | Default | Range |
| --- | --- | --- |
| `freq` Cutoff | 800 | 40–18000 Hz |
| `slope` Slope | 24 | 12, 24, 48 |
| `q` Resonance (Q) | 0.707 | 0.3–8 |

### `highpass` — High pass

Cuts the lows below the cutoff frequency.

**When:** To clean rumble from voices (80–120 Hz), make music thin and distant, or suggest a small speaker.

| Param | Default | Range |
| --- | --- | --- |
| `freq` Cutoff | 200 | 20–8000 Hz |
| `slope` Slope | 24 | 12, 24, 48 |
| `q` Resonance (Q) | 0.707 | 0.3–8 |

### `bandpass` — Band pass

Keeps only a band of frequencies around the center.

**When:** To isolate a slice (a voice on a speaker, a nasal sound) or as the base of radio and phone effects.

| Param | Default | Range |
| --- | --- | --- |
| `freq` Center | 1200 | 100–8000 Hz |
| `octaves` Width | 2 | 0.3–5 oct |

### `eq` — Three-band EQ

Adjusts lows, mids and highs.

**When:** To add body (lows), presence (2–4 kHz mids) or air (highs) to a voice or music.

| Param | Default | Range |
| --- | --- | --- |
| `low` Lows (120 Hz) | 3 | -18–18 dB |
| `mid` Mids | 4 | -18–18 dB |
| `midFreq` Mid freq. | 2500 | 300–6000 Hz |
| `high` Highs (8 kHz) | 3 | -18–18 dB |

### `muffled` — Behind the wall

Dull sound with lows that bleed through, as if from the next room.

**When:** Party music on the other side of a door, neighbors, an argument in another room, or the outside world heard from inside a car.

| Param | Default | Range |
| --- | --- | --- |
| `thickness` Thickness | 0.6 | 0–1 |
| `boom` Bleeding lows | 5 | 0–12 dB |

## Spaces

### `reverb` — Reverb _(adds tail)_

Convolution reverb with preset spaces (bathroom, room, hall, cathedral, cave, stadium).

**When:** To place a voice or sound in a physical place, give an epic moment scale, or glue together sounds that are too dry.

| Param | Default | Range |
| --- | --- | --- |
| `space` Space | hall | bathroom, room, studio, hall, cathedral, cave, stadium |
| `mix` Amount | 0.35 | 0–1 |
| `size` Size | 1 | 0.25–2.5 |

### `echo` — Echo / delay _(adds tail)_

Regular repeats that fade away.

**When:** For the end of a line, shouting across mountains, memory effects, or closing a video with a fading tail.

| Param | Default | Range |
| --- | --- | --- |
| `time` Time | 320 | 40–1500 ms |
| `feedback` Feedback | 0.45 | 0.05–0.85 |
| `repeats` Repeats | 4 | 1–8 |
| `mix` Amount | 0.5 | 0–1 |

### `slapback` — Slapback _(adds tail)_

A single short bounce (80–140 ms), typical of rockabilly and alleys.

**When:** For a hallway or alley, a retro voice, or hits that need to bounce off nearby walls.

| Param | Default | Range |
| --- | --- | --- |
| `time` Time | 110 | 50–200 ms |
| `level` Level | 0.45 | 0–1 |

### `distance` — Far away _(adds tail)_

Pushes the source away: fewer highs, less level and relatively more reverb.

**When:** Someone shouting from afar, a siren blocks away, a character walking away from the camera.

| Param | Default | Range |
| --- | --- | --- |
| `distance` Distance | 0.6 | 0–1 |
| `space` Setting | outdoor | outdoor, indoor |

### `doppler` — Pass-by (Doppler) _(at a moment)_

A source passing the camera: pitch above normal while it approaches and below as it leaves (the physical Doppler curve), level peaking at the pass, a pan across the field and duller sound far away. Keeps the duration.

**When:** A car, motorbike, train, plane or drone going past. Apply it to the isolated sound, usually a sample that then gets layered (a car sample rendered through doppler, then mixed in with layer), not to a whole mix: it bends the pitch of everything.

| Param | Default | Range |
| --- | --- | --- |
| `at` Closest at | 2 | 0–600 s |
| `speed` Speed | 90 | 10–600 km/h |
| `distance` Closest distance | 10 | 1–300 m |
| `direction` Direction | left-right | left-right, right-left, center |
| `falloff` Level falloff | 1 | 0–1 |
| `air` Air | 0.5 | 0–1 |

### `underwater` — Underwater

Highs almost gone, slow modulation and low resonances, like going under.

**When:** When the camera goes into the water, for disorientation, fainting, being stunned or a blurry memory. Combine with from/to and a fade for the transition.

| Param | Default | Range |
| --- | --- | --- |
| `depth` Depth | 0.6 | 0–1 |
| `wobble` Movement | 0.5 | 0–1 |

## Era & medium

### `speaker` — Speaker

Plays the signal through a device: earpiece, phone, laptop, radio, TV, walkie, megaphone or PA (convolution).

**When:** Any sound that comes out of a device in the scene: a video on a character's phone, a laptop, the TV in the background, a station loudspeaker. It is the base of the radio, TV and phone effects.

| Param | Default | Range |
| --- | --- | --- |
| `model` Device | phone | earpiece, phone, laptop, radio, tv, walkie, megaphone, pa |
| `drive` Saturation | 3 | 0–18 dB |
| `mix` Amount | 1 | 0–1 |

### `am-radio` — AM radio

Transistor radio: small speaker, broadcast compression, saturation and crackling static.

**When:** Period newscasts, broadcasts in an old car, historic speeches, music playing 'inside' the scene (diegetic) from a radio.

| Param | Default | Range |
| --- | --- | --- |
| `drive` Distortion | 6 | 0–18 dB |
| `noise` Static | 0.4 | 0–1 |
| `drift` Tuning drift | 0.3 | 0–1 |

### `old-tv` — Old TV

Tube TV speaker with a resonant cabinet, mains hum and hiss.

**When:** A TV on in the living room, archive footage, old commercials, the voice of a 70s host.

| Param | Default | Range |
| --- | --- | --- |
| `noise` Hiss | 0.35 | 0–1 |
| `hum` Hum | 0.4 | 0–1 |
| `mains` Mains | 50 | 50, 60 |

### `telephone` — Landline

A real phone line: 8 kHz band, µ-law quantization and a resonant earpiece.

**When:** The other end of a landline call, answering machines, switchboards, period calls.

| Param | Default | Range |
| --- | --- | --- |
| `noise` Line noise | 0.15 | 0–1 |
| `drive` Saturation | 3 | 0–12 dB |

### `cellphone` — Bad cell signal

Compressed cell call (narrowband codec) with dropouts, artifacts and a metallic voice.

**When:** Cell calls, video calls that freeze, someone talking from a place with no signal, tension in thrillers.

| Param | Default | Range |
| --- | --- | --- |
| `signal` Bad signal | 0.5 | 0–1 |
| `bits` Codec quality | 7 | 4–12 bits |

### `walkie-talkie` — Walkie-talkie

Handheld radio: very narrow band, hard clipping, extreme compression and static.

**When:** Police, military, pilot or tactical comms, or a voice giving orders from afar.

| Param | Default | Range |
| --- | --- | --- |
| `drive` Distortion | 14 | 0–24 dB |
| `noise` Static | 0.5 | 0–1 |

### `megaphone` — Megaphone

Megaphone horn: horn resonances, aggressive saturation and a metallic bounce.

**When:** Protests, station announcements, a coach, a fairground loudspeaker or an alarm voice.

| Param | Default | Range |
| --- | --- | --- |
| `drive` Distortion | 14 | 0–24 dB |

### `vinyl` — Vinyl

A vinyl record like iZotope Vinyl: dust, a scratch that repeats every turn, wear, warp and motor rumble.

**When:** Archive music, nostalgia, a warm flashback, a scene with a record player.

| Param | Default | Range |
| --- | --- | --- |
| `rpm` RPM | 33 | 33, 45, 78 |
| `dust` Dust | 0.5 | 0–1 |
| `scratch` Scratch | 0.3 | 0–1 |
| `wear` Wear | 0.4 | 0–1 |
| `warp` Warp | 0.3 | 0–1 |
| `rumble` Rumble | 0.3 | 0–1 |

### `phonograph` — Gramophone

A 78 RPM shellac record through an acoustic horn: very narrow band, nasal resonance and dense crackle.

**When:** Recordings from 1900–1930, silent film, the distant past or an extreme archive look.

| Param | Default | Range |
| --- | --- | --- |
| `crackle` Crackle | 0.7 | 0–1 |
| `noise` Hiss | 0.5 | 0–1 |

### `cassette` — Cassette

Tape like RC-20: irregular wow and flutter, tape saturation, low boost, level dropouts and hiss.

**When:** Home videos from the 80s–90s, mixtapes, VHS, childhood memories, a warm lo-fi look.

| Param | Default | Range |
| --- | --- | --- |
| `wobble` Wow & flutter | 0.5 | 0–1 |
| `saturation` Saturation | 0.5 | 0–1 |
| `loss` Dropouts | 0.3 | 0–1 |
| `noise` Hiss | 0.4 | 0–1 |
| `age` Age | 0.4 | 0–1 |

### `lofi` — Lo-fi

Bit and sample-rate reduction with gentle filtering and some wobble.

**When:** A lo-fi look, retro digital content, study beats, or degrading something on purpose.

| Param | Default | Range |
| --- | --- | --- |
| `bits` Bits | 8 | 4–16 |
| `downsample` Downsample | 5 | 1–16 |
| `tone` Tone | 4500 | 1500–16000 Hz |
| `wobble` Wobble | 0.3 | 0–1 |

### `8bit` — 8-bit

Extreme quantization and aliasing like an old console.

**When:** Retro video games, pixelated transitions, nerdy humor or glitch.

| Param | Default | Range |
| --- | --- | --- |
| `bits` Bits | 4 | 2–8 |
| `downsample` Downsample | 12 | 1–32 |

## Modulation

### `chorus` — Chorus

Doubles the signal with small timing variations: it sounds wider and brighter.

**When:** To thicken pads or voices, or for a dreamy or soft-crowd feeling.

| Param | Default | Range |
| --- | --- | --- |
| `depth` Depth | 0.5 | 0–1 |
| `mix` Amount | 0.5 | 0–1 |

### `flanger` — Flanger

A metallic comb-filter sweep, like a jet.

**When:** Psychedelic transitions, teleportation, sci-fi sounds or a 'something is wrong' effect.

| Param | Default | Range |
| --- | --- | --- |
| `speed` Speed | 0.4 | 0.1–5 Hz |
| `depth` Depth | 4 | 0–10 ms |
| `regen` Feedback | 40 | -95–95 % |

### `phaser` — Phaser

A smooth, swirling phase sweep.

**When:** Soft sci-fi ambiences, voices in dreams, transitions with movement.

| Param | Default | Range |
| --- | --- | --- |
| `speed` Speed | 0.5 | 0.1–2 Hz |
| `decay` Intensity | 0.6 | 0–0.99 |

### `tremolo` — Tremolo

Oscillates the volume periodically.

**When:** Helicopters, fans, flickering lights, surf guitars, pulsing tension.

| Param | Default | Range |
| --- | --- | --- |
| `speed` Speed | 6 | 0.5–30 Hz |
| `depth` Depth | 0.6 | 0–1 |

### `vibrato` — Vibrato

Oscillates the pitch periodically.

**When:** Dizziness, drunkenness, melting tape, voices trembling with fear.

| Param | Default | Range |
| --- | --- | --- |
| `speed` Speed | 5 | 0.1–12 Hz |
| `depth` Depth | 0.3 | 0–1 |

## Voices & characters

### `pitch` — Pitch shift

Raises or lowers the pitch without changing the duration (rubberband).

**When:** Chipmunk or monster voices, anonymizing someone, tuning an effect to fit the music.

| Param | Default | Range |
| --- | --- | --- |
| `semitones` Semitones | -5 | -24–24 st |
| `formant` Preserve formants | false | true, false |

### `robot` — Robot

Ring modulation with a metallic, digital touch.

**When:** Androids, AI, system voices, synthetic alarms or a tech villain.

| Param | Default | Range |
| --- | --- | --- |
| `freq` Frequency | 60 | 20–400 Hz |
| `mix` Amount | 0.8 | 0–1 |

### `monster` — Monster

A deep, saturated voice with body.

**When:** Creatures, demons, a threatening character, horror comedy.

| Param | Default | Range |
| --- | --- | --- |
| `semitones` Semitones | -8 | -18–-3 st |

### `chipmunk` — Chipmunk

A high voice with a sped-up timbre, without changing the duration.

**When:** Humor, talking pets, cartoon voices.

| Param | Default | Range |
| --- | --- | --- |
| `semitones` Semitones | 8 | 3–15 st |

### `ghost` — Ghost _(adds tail)_

An ethereal voice: lower, widened, with a long reverb and no body.

**When:** Apparitions, voices from beyond, whispers in a character's head, atmospheric horror.

| Param | Default | Range |
| --- | --- | --- |
| `mix` Amount | 0.6 | 0–1 |

### `alien` — Alien

Inharmonic frequency shift with modulation: a non-human voice.

**When:** Aliens, unknown transmissions, sci-fi creatures.

| Param | Default | Range |
| --- | --- | --- |
| `shift` Shift | 140 | -400–400 Hz |

## Narrative

### `dream` — Dream _(adds tail)_

Soft, wide and distant: chorus, light vibrato, rounded highs and a big reverb.

**When:** Dream sequences, fantasies, entering a character's imagination, daydreaming moments.

| Param | Default | Range |
| --- | --- | --- |
| `amount` Amount | 0.6 | 0–1 |

### `flashback` — Flashback _(adds tail)_

A memory: narrowed band, echo and reverb that detach it from the present.

**When:** Memories, voices from the past, testimonies coming back to a character's mind.

| Param | Default | Range |
| --- | --- | --- |
| `amount` Amount | 0.6 | 0–1 |

### `tinnitus` — Shell shock (post-explosion)

The world goes dull and a high ringing stays in the ear.

**When:** After an explosion or a blow, shock, a panic attack, the war scene where everything goes deaf. Use from/to with a long fade so the sound comes back.

| Param | Default | Range |
| --- | --- | --- |
| `deafness` Deafness | 0.8 | 0–1 |
| `tone` Ring pitch | 6500 | 2000–12000 Hz |
| `ring` Ring length | 5 | 0.5–15 s |
| `level` Ring level | 0.4 | 0–1 |

### `slowmo` — Slow motion _(changes duration)_

Lowers speed and pitch together, like slower tape. Changes the duration.

**When:** Under a slow-motion shot, impact moments, a hit that stretches.

| Param | Default | Range |
| --- | --- | --- |
| `speed` Speed | 0.6 | 0.25–0.95 x |

### `speedup` — Speed up _(changes duration)_

Changes speed without changing pitch (or with pitch, if asked). Changes the duration.

**When:** Fitting audio to a shorter shot, timelapses, sped-up humor.

| Param | Default | Range |
| --- | --- | --- |
| `speed` Speed | 1.5 | 0.5–4 x |
| `keepPitch` Keep pitch | true | true, false |

## Transitions

### `filter-sweep` — Filter sweep

Opens or closes a low pass (or high pass) over time.

**When:** Open the music on a drop (200 Hz to 18 kHz), close it when entering a memory, go in and out of the water, or build tension before a cut.

| Param | Default | Range |
| --- | --- | --- |
| `filter` Filter | lowpass | lowpass, highpass |
| `fromFreq` From | 250 | 30–20000 Hz |
| `toFreq` To | 18000 | 30–20000 Hz |
| `start` Start | 0 | 0–600 s |
| `duration` Duration | 3 | 0.05–60 s |
| `q` Resonance (Q) | 1.2 | 0.5–10 |

### `tape-stop` — Tape stop _(changes duration)_

The tape brakes to a halt: pitch and speed fall together. The audio ends there.

**When:** Abrupt comedic cuts, a 'wait, what?' record scratch, cutting the music before a dramatic silence.

| Param | Default | Range |
| --- | --- | --- |
| `at` Moment | 2 | 0–600 s |
| `length` Brake length | 1 | 0.2–4 s |

### `reverse` — Reverse _(changes duration)_

Reverses the whole audio.

**When:** Supernatural effects, rewinding, 'back in time' transitions, building swells from a hit.

### `reverse-swell` — Reverse reverb (swell) _(changes duration)_

A reversed reverb tail that grows into the sound. Adds time before the start.

**When:** A word or hit that enters with an 'inhale' before it, ghostly appearances, horror transitions. The original sound starts 'decay' seconds later.

| Param | Default | Range |
| --- | --- | --- |
| `decay` Swell length | 1.5 | 0.3–6 s |
| `mix` Amount | 0.8 | 0.2–1 |

## Dynamics & mix

### `voice-clean` — Clean voice

A typical voice chain: high pass, de-esser, presence and compression.

**When:** Narration, interviews and voice-overs before mixing them with music. It is the first step for almost any voice.

| Param | Default | Range |
| --- | --- | --- |
| `lowcut` Low cut | 90 | 40–200 Hz |
| `presence` Presence | 2.5 | 0–8 dB |
| `compression` Compression | 0.5 | 0–1 |
| `deess` De-esser | 0.3 | 0–1 |

### `denoise` — Denoise

Lowers steady background noise (hiss, fan, room tone) under a voice with spectral noise reduction. Compensates its latency.

**When:** Dialogue or voice-over recorded at home or on location with a constant hiss or room noise, before voice-clean and the music. It does not remove clicks, hum or reverb.

| Param | Default | Range |
| --- | --- | --- |
| `reduction` Reduction | 12 | 1–40 dB |
| `floor` Noise floor | -50 | -80–-20 dB |
| `noise` Noise type | mixed | mixed, hiss, room |

### `de-esser` — De-esser

Tames harsh 's' and 'sh' sounds: while a sibilant sounds, the highs above the chosen frequency go down.

**When:** Voices with sharp esses (close mics, bright voices, generated voices), especially after a presence boost or compression. Its detector follows level: apply it to the voice at its final level.

| Param | Default | Range |
| --- | --- | --- |
| `amount` Amount | 0.6 | 0–1 |
| `freq` Frequency | 4000 | 1000–8000 Hz |

### `compressor` — Compressor

Reduces the difference between loud and soft parts.

**When:** To keep a voice even and intelligible, give hits punch, or settle a piece of music.

| Param | Default | Range |
| --- | --- | --- |
| `threshold` Threshold | -20 | -60–0 dB |
| `ratio` Ratio | 4 | 1–20 |
| `attack` Attack | 10 | 0.1–200 ms |
| `release` Release | 150 | 10–2000 ms |
| `makeup` Makeup | 4 | 0–24 dB |

### `limiter` — Limiter

Keeps the level under a ceiling; with Drive it also raises it, like a maximizer. Compensates latency.

**When:** At the end of a chain to avoid clipping (the default), or with Drive to make a hit or music louder and denser.

| Param | Default | Range |
| --- | --- | --- |
| `drive` Drive | 0 | 0–24 dB |
| `ceiling` Ceiling | -1 | -12–0 dB |

### `gate` — Gate

Silences what falls below the threshold (background noise between phrases). If the source has no noise between phrases, nothing changes.

**When:** Clean hum or room tone between phrases of a voice recorded at home, or trim the tails of hits.

| Param | Default | Range |
| --- | --- | --- |
| `threshold` Threshold | -40 | -70–-10 dB |
| `release` Release | 200 | 10–1000 ms |

### `loudness` — Loudness normalize

Sets the perceived volume to a LUFS target (EBU R128) with a true-peak ceiling.

**When:** On export: -14 LUFS for YouTube, Instagram and TikTok, -16 for podcasts, -23 for broadcast. Also to match clips from different sources.

| Param | Default | Range |
| --- | --- | --- |
| `target` Target | -14 | -30–-8 LUFS |
| `truePeak` True peak | -1 | -6–0 dBTP |

### `fade` — Fade in / out

Fade in and fade out. The fade out does not need to know the duration.

**When:** Start and end of music, soft ambience entrances, avoiding clicks at cuts.

| Param | Default | Range |
| --- | --- | --- |
| `in` Fade in | 0.5 | 0–30 s |
| `out` Fade out | 1.5 | 0–30 s |
| `curve` Curve | qsin | tri, qsin, exp, log |

### `gain` — Gain

Raises or lowers the level in dB.

**When:** Simple level adjustments inside a chain.

| Param | Default | Range |
| --- | --- | --- |
| `db` Gain | -6 | -48–24 dB |

### `stereo-width` — Stereo width

Widens the stereo image, even of mono sources (delayed side injection, mono-compatible). 0 = mono.

**When:** Open up music or an ambience to leave room for the voice in the center, widen a mono effect, or fold something to mono.

| Param | Default | Range |
| --- | --- | --- |
| `width` Width | 1.5 | 0–2 |
