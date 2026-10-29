import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn("text-xs font-semibold uppercase tracking-wide text-ink-muted", className)} {...props} />
));

Label.displayName = "Label";
