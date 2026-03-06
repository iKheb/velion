import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border border-velion-steel/80 bg-velion-discord/70 px-3 text-sm text-velion-text outline-none transition focus:border-velion-fuchsia focus-visible:ring-2 focus-visible:ring-velion-fuchsia/30",
        className,
      )}
      {...props}
    />
  );
}
