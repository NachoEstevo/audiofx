import { OrbSwatch } from "@/components/ui/orb-swatch";

/** The AudioFX mark: a small fluid orb with four waveform bars; it flows while audio plays. */
export function Logo(props: { playing: boolean; getLevel: () => number }) {
  return (
    // Both layers share one grid cell, so the bars sit on the orb (.orb-swatch sets its own position).
    <span className="grid size-8 *:col-start-1 *:row-start-1">
      <OrbSwatch color="#1A73F2" seed="audiofx-logo" size={32} mode={props.playing ? "playing" : "idle"} getLevel={props.getLevel} className="is-logo" />
      <svg viewBox="0 0 64 64" className="z-10 size-8 drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]" aria-hidden>
        <g fill="#fff">
          <rect x="17" y="27" width="5" height="10" rx="2.5" />
          <rect x="25" y="20" width="5" height="24" rx="2.5" />
          <rect x="33" y="15" width="5" height="34" rx="2.5" />
          <rect x="41" y="23" width="5" height="18" rx="2.5" />
        </g>
      </svg>
    </span>
  );
}
