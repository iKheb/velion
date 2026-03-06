import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-xl border border-velion-steel/80 bg-velion-black/40 px-3 text-sm text-zinc-100 outline-none transition focus:border-velion-fuchsia focus-visible:ring-2 focus-visible:ring-velion-fuchsia/30",
        className,
      )}
      {...props}
    />
  );
}
