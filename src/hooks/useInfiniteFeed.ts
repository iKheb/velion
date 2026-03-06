import { useInfiniteQuery } from "@tanstack/react-query";
import { getFeed, type FeedMode } from "@/services/social.service";

export const useInfiniteFeed = (mode: FeedMode = "for_you") => {
  return useInfiniteQuery({
    queryKey: ["feed", mode],
    queryFn: ({ pageParam = 0 }) => getFeed(pageParam, 6, mode),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.length < 6 ? undefined : pages.length),
  });
};
