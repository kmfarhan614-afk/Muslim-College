"use client";

import { forwardRef } from "react";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loadingText?: string;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/20 disabled:pointer-events-none disabled:opacity-50 tabular-nums";

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs rounded-lg",
  md: "h-10 px-4 text-sm rounded-lg",
  lg: "h-11 px-5 text-sm rounded-xl",
  icon: "h-10 w-10 rounded-lg",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-navy-800 text-white shadow-brand hover:bg-navy-700 active:bg-navy-900",
  secondary: "bg-navy-50 text-navy-900 hover:bg-navy-100 active:bg-navy-200",
  outline: "border border-line bg-surface text-ink hover:bg-surface-muted active:bg-navy-50",
  ghost: "text-ink-soft hover:bg-surface-muted active:bg-navy-50",
  danger: "bg-danger text-white hover:bg-[#b11236] active:bg-[#9e0f30]",
  success: "bg-success text-white hover:bg-[#036a4e] active:bg-[#025d41]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      loadingText,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        className={cn(base, sizes[size], variants[variant], className)}
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingText ?? children}
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
