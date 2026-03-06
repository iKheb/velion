import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const invalidateMany = async (queryClient: QueryClient, keys: QueryKey[]): Promise<void> => {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
};

