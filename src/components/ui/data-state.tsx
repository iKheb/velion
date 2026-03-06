import { AlertTriangle, Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

interface DataStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: DataStateProps) {
  return (
    <Card className="space-y-2 border-dashed text-center">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-velion-black/50 text-zinc-300">
        <Inbox size={18} />
      </div>
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      {description ? <p className="text-xs text-zinc-400">{description}</p> : null}
      {action}
    </Card>
  );
}

export function ErrorState({ title, description, action }: DataStateProps) {
  return (
    <Card className="space-y-2 border-rose-900/50 text-center">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-950/50 text-rose-300">
        <AlertTriangle size={18} />
      </div>
      <p className="text-sm font-semibold text-rose-200">{title}</p>
      {description ? <p className="text-xs text-zinc-300">{description}</p> : null}
      {action}
    </Card>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={`skeleton-${index}`} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
