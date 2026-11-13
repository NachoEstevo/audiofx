import { ArrowLeftRight, AudioWaveform, Building2, Clapperboard, Drama, Film, Gauge, Radio, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { Category } from "../../src/core/types";

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  cinema: Film,
  filter: SlidersHorizontal,
  space: Building2,
  era: Radio,
  modulation: AudioWaveform,
  character: Drama,
  narrative: Clapperboard,
  transition: ArrowLeftRight,
  dynamics: Gauge,
};
