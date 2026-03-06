import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({ id, label, hint, error, required = false, className, children }: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-semibold text-zinc-200">
        {label}
        {required ? <span className="ml-1 text-rose-400">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
