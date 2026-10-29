import { cn } from "@/lib/utils";
import type { Tones } from "@/lib/constants";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tones;
  variant?: "soft" | "solid";
}

const tones: Record<Tones, { soft: string; solid: string }> = {
  success: { soft: "bg-success-soft text-success border border-transparent", solid: "bg-success text-white" },
  danger: { soft: "bg-danger-soft text-danger border border-transparent", solid: "bg-danger text-white" },
  warning: { soft: "bg-warning-soft text-warning border border-transparent", solid: "bg-warning text-white" },
  info: { soft: "bg-info-soft text-info border border-transparent", solid: "bg-info text-white" },
  neutral: { soft: "bg-surface-muted text-ink-soft border border-line", solid: "bg-navy-800 text-white" },
  brand: { soft: "bg-navy-50 text-navy-800 border border-transparent", solid: "bg-navy-800 text-white" },
};

export function Badge({ className, tone = "neutral", variant = "soft", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
        tones[tone][variant],
        className,
      )}
      {...props}
    />
  );
}
