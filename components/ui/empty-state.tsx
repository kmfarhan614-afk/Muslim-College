import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 px-6 py-10 text-center sm:py-12", className)}>
      {icon ? (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface-muted text-ink-muted shadow-card">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md flex-col gap-2">
        <h3 className="text-base font-semibold text-navy-900">{title}</h3>
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
