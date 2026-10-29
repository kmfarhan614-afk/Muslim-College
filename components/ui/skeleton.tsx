import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-lg bg-navy-50 [animation:var(--animate-skeleton)]", className)}
      {...props}
    />
  );
}
