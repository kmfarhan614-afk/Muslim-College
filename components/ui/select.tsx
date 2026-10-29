import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, error, children, ...props }, ref) => {
  return (
    <div className="relative flex flex-col gap-1.5">
      <select
        ref={ref}
        className={cn(
          "h-10 w-full appearance-none rounded-lg border border-line bg-surface px-3 pr-9 text-sm text-ink transition hover:border-line-strong focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-60",
          error && "border-danger focus:border-danger focus:ring-danger/20",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-[34px] h-4 w-4 -translate-y-1/2 text-ink-faint" />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
});

Select.displayName = "Select";
