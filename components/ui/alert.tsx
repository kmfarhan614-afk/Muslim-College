import { cn } from "@/lib/utils";
import type { Tones } from "@/lib/constants";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: Tones;
  title?: string;
  icon?: React.ReactNode;
}

const tones: Record<Tones, { container: string; icon: string }> = {
  success: { container: "border-success-line/60 bg-success-soft text-success", icon: "text-success" },
  danger: { container: "border-absent-line/60 bg-danger-soft text-danger", icon: "text-danger" },
  warning: { container: "border-leave-line/60 bg-warning-soft text-warning", icon: "text-warning" },
  info: { container: "border-accent-400/40 bg-info-soft text-info", icon: "text-info" },
  neutral: { container: "border-line bg-surface-muted text-ink-soft", icon: "text-ink-muted" },
  brand: { container: "border-navy-200 bg-navy-50 text-navy-800", icon: "text-navy-700" },
};

const defaultIcon: Record<Tones, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5" />,
  danger: <AlertCircle className="h-5 w-5" />,
  warning: <TriangleAlert className="h-5 w-5" />,
  info: <Info className="h-5 w-5" />,
  neutral: <Info className="h-5 w-5" />,
  brand: <Info className="h-5 w-5" />,
};

export function Alert({ className, tone = "info", title, icon, children, ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn("flex gap-3 rounded-lg border p-3 text-sm animate-fade-in", tones[tone].container, className)}
      {...props}
    >
      <div className={cn("mt-0.5 shrink-0", tones[tone].icon)}>{icon ?? defaultIcon[tone]}</div>
      <div className="flex flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-sm leading-relaxed opacity-95">{children}</div> : null}
      </div>
    </div>
  );
}
