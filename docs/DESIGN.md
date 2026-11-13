# How AudioFX is built

## One source of truth

Effects live in `src/core/effects/*.ts`. Each one declares its params (ranges, defaults, units), a description, "when to use it", and a `build` function that returns a piece of an ffmpeg filtergraph. The CLI, the studio and `CATALOG.md` (`pnpm catalog`) all read from there.

`src/core/compile.ts` chains the steps into one graph that works with `ffmpeg -af`:

- **Windows** (`@from-to`): the signal is split into dry and processed, and crossfaded with `--fade` seconds at each edge.
- **Mix** (`--mix`): dry/wet blend per step.
- **Tails**: effects with a tail (reverb, echo, ghost…) add 3 s of silence at the end by default (`--tail`), so the tail is not cut.
- **Sync**: the sound onset never shifts by more than one frame at 24 fps; the tests check it for every effect. Effects that change the duration (`slowmo`, `speedup`, `tape-stop`, `reverse`, `reverse-swell`, `stutter`) don't accept windows.

## Cinema moments

`src/core/effects/cinema.ts` synthesizes hits, risers, whooshes, sub drops and braams inside the filtergraph (`aevalsrc`, `anoisesrc`, sweeps with `asendcmd`) and mixes them in at `at` with `adelay` + `amix`. Chirps integrate the phase so they don't click. Levels were calibrated by measuring RMS and peak per window over a real voice and song.

## Sample layers

`layer` reads a file inside the filtergraph with `amovie`, so a chain with samples still has one input and one output and works with `ffmpeg -af`. The path is escaped twice (`filterPath` in `graph.ts`): once for the graph parser and once for the filter's own option parser.

Compiling stays pure, because the studio also compiles in the browser to validate a chain. Everything that needs the disk happens in `prepareSteps` (`src/core/prepare.ts`), which the CLI and the studio server run before compiling: it turns `library:<id>` references into paths, checks that files exist and, for `align=onset` or `align=peak`, measures the sample's sync point (the first 5 ms block above 25% of the loudest one, or the loudest block) and writes it into `sync`.

The studio server accepts only `library:<id>` references in a render request, never paths, and the *ffmpeg -af* and *Python* export tabs point to `sfx graph` for chains with a library sample, since the browser has no path to print.

Samples are kept in `~/.audiofx/samples` with a `.json` next to each file (id, title, source, measured duration and sync points). `sfx sample add` downloads from a URL without storing it: signed links from a sound library expire and are not the user's to publish.

## Mix

- `src/core/mix.ts` is pure like the compiler: a project (tracks of role voice, music or sfx; clips placed with `at`; chains per clip, track and master) compiles to one `-filter_complex`. Each embedded chain gets its own label prefix so they never collide. A track with steps and no clips is silence that cinema effects turn into sound.
- **Ducking by an exact depth**: the voices open a gate, the gate drives `sidechaincompress` over a constant signal, and the music is multiplied by that curve. The depth is then the same however loud the voice is, which a compressor keyed straight by the voice cannot give.
- **Loudness in two passes**: `renderMix` renders once without the loudness stage, measures it (EBU R128) and applies a fixed gain before the ceiling. Single-pass `loudnorm` landed up to 4 LU under the target on mixes with a wide loudness range and reshaped their dynamics. A printed graph (`compileMix` alone) still uses the single-pass stage.
- Disk work (resolving `library:<id>`, probing durations, measuring clip alignment) lives in `src/core/mix-run.ts`; cuts come from ffmpeg's `scdet` in `src/core/media.ts`.
- `src/core/sections.ts` compares the level after each point with the level before it, overall and below 150 Hz, and snaps the change to the nearest attack. It proposes drop candidates with numbers; which one is the drop is for the user's ear.

## No licensed material

The repo ships no audio. Reverb impulse responses are generated from exponentially decaying noise, and device speakers are short convolution kernels built in code. Noises and IRs use a seed (`--seed`), so the same chain renders byte-identical output.

## Gain staging

`pnpm tsx scripts/audit-levels.ts [voice] [music]` renders every effect with its defaults and reports the loudness change and true peak. Effects aim to stay within a few dB of the source unless the level change is the point (distance, behind the wall, tinnitus). The default `limiter` is a -1 dB safety ceiling that does not raise the level.

The studio shows the level change against the original and the sample peak of every render. Renders are 16-bit, so it detects clipping by counting full-scale samples rather than with a peak threshold that would flag any master at -0.1 dB.

## Known ffmpeg quirk

ffmpeg 7.1's `vibrato` filter outputs NaN or garbage in its first milliseconds and contaminates the following filters. AudioFX replaces it with a modulated delay (a single-voice `chorus` with no dry signal).

## Studio

- `src/server.ts` serves the built web app, normalizes sources to 48 kHz WAV, renders chains with the same compiler, and calls ElevenLabs. The browser only ever gets ids for library files, never paths.
- `src/library.ts` walks the configured folders up to 5 levels deep without following links or junctions.
- **Orbs**: browsers allow about 16 WebGL contexts per page, so one hidden context renders every tile's orb and copies the frame into a 2D canvas. Idle orbs are painted once; only hovered, playing or rendering ones animate.

## ElevenLabs

`src/elevenlabs.ts` uses plain `fetch` against the REST API (no SDK): sound generation, text to speech and music. It looks for `ELEVENLABS_API_KEY` in the environment, then in `.env` in the current folder, the repo and `~/.audiofx/.env`, and never prints the key. `ELEVENLABS_API_BASE` points it elsewhere; the tests use a stub.
