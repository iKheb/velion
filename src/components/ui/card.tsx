import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-velion-steel/70 bg-velion-discord/70 p-5 backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}
