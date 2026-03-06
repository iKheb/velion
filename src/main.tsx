import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { RouterProvider } from "react-router-dom";
import { router } from "@/routes";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastCenter } from "@/components/ui/toast-center";
import { setupGlobalErrorHandlers } from "@/services/observability.service";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 600_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("forbidden") || message.includes("not authenticated")) return false;
        return failureCount < 2;
      },
    },
  },
});

setupGlobalErrorHandlers();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ToastCenter />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
