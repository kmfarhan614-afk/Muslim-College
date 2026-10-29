import { cn } from "@/lib/utils";
import { Check, Minus, X } from "lucide-react";
import type { AttendanceStatus } from "@/types";

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: AttendanceStatus;
  size?: "sm" | "md";
}

const config: Record<AttendanceStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  present: { label: "Present", icon: <Check className="h-3.5 w-3.5" />, cls: "bg-present-soft text-present border-present-line/60" },
  absent: { label: "Absent", icon: <X className="h-3.5 w-3.5" />, cls: "bg-absent-soft text-absent border-absent-line/60" },
  leave: { label: "Leave", icon: <Minus className="h-3.5 w-3.5" />, cls: "bg-leave-soft text-leave border-leave-line/60" },
};

const sizes: Record<NonNullable<StatusPillProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

export function StatusPill({ status, size = "sm", className, ...props }: StatusPillProps) {
  const meta = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium tabular-nums",
        meta.cls,
        sizes[size],
        className,
      )}
      {...props}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}
