import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { EffectStep } from "../../../src/core/types";
import { chainJson, cliCommand, filtergraph, pythonSnippet } from "../exporters";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TABS = { cli: "CLI", af: "ffmpeg -af", python: "Python", json: "JSON" } as const;
type Tab = keyof typeof TABS;

export function ExportPanel({ steps, error }: { steps: EffectStep[]; error: string | null }) {
  const [tab, setTab] = useState<Tab>("cli");
  const [copied, setCopied] = useState(false);
  const output = error
    ? error
    : !steps.length
      ? "Add an effect to get the command."
      : tab === "cli"
        ? cliCommand(steps)
        : tab === "af"
          ? filtergraph(steps)
          : tab === "python"
            ? pythonSnippet(steps)
            : chainJson(steps);

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="rounded-3xl bg-card p-5 shadow-ring" aria-label="Export">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-lg font-normal tracking-[-0.02em]">Use it in your video</h2>
          <p className="text-xs text-muted-foreground">Exports exactly what you are hearing.</p>
        </div>
        <div className="flex rounded-full bg-muted p-1" role="tablist">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "h-7 cursor-pointer rounded-full px-3 text-[13px] transition-all",
                tab === t ? "bg-card shadow-ring" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TABS[t]}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto" onClick={copy} disabled={!!error || !steps.length}>
          {copied ? <Check strokeWidth={1.5} /> : <Copy strokeWidth={1.5} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        className={cn(
          "max-h-72 overflow-auto rounded-2xl bg-muted/70 p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all",
          error && "text-danger",
        )}
      >
        {output}
      </pre>
    </section>
  );
}
