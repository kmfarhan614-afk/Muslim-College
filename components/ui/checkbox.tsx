import { forwardRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-") : undefined);

    return (
      <label htmlFor={inputId} className="flex items-start gap-2">
        <span className="relative mt-0.5 inline-flex h-5 w-5 items-center justify-center">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            className={cn(
              "peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-line bg-surface transition checked:border-accent-600 checked:bg-accent-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-60",
              className,
            )}
            {...props}
          />
          <Check className="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 transition peer-checked:opacity-100" />
        </span>
        {label || description ? (
          <span className="flex flex-col gap-0.5">
            {label ? <span className="text-sm font-medium text-ink">{label}</span> : null}
            {description ? <span className="text-xs text-ink-muted">{description}</span> : null}
          </span>
        ) : null}
      </label>
    );
  },
);

Checkbox.displayName = "Checkbox";
