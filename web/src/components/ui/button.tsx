import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-foreground text-white hover:bg-foreground/85",
  secondary: "bg-card text-foreground shadow-ring hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
} as const;

const SIZES = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-4 text-sm",
  icon: "size-9",
  "icon-sm": "size-7",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

/** Pill button: black primary, white secondary with a ring shadow, ghost with no background. */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-normal whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:pointer-events-none disabled:opacity-40",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
