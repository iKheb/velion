import { useInView } from "framer-motion";
import { useRef } from "react";
import { EmptyState, ErrorState } from "@/components/ui/data-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PostCard } from "@/features/social/post-card";
import { useInfiniteFeed } from "@/hooks/useInfiniteFeed";
import { toAppError } from "@/services/error.service";
import type { FeedMode } from "@/services/social.service";

interface FeedListProps {
  mode: FeedMode;
}

export function FeedList({ mode }: FeedListProps) {
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteFeed(mode);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inView = useInView(anchorRef, { once: false });

  if (inView && hasNextPage && !isFetchingNextPage) {
    void fetchNextPage();
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="No se pudo cargar el feed" description={toAppError(error)} />;
  }

  const posts = data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      {!posts.length && (
        <EmptyState
          title={mode === "following" ? "Aun no hay publicaciones de cuentas que sigues" : "No hay publicaciones por ahora"}
          description="Publica algo nuevo o cambia de pestaña para descubrir contenido."
        />
      )}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      <div ref={anchorRef} className="h-8" />
      {isFetchingNextPage && <Skeleton className="h-24 w-full" />}
    </div>
  );
}
