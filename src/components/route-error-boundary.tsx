import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { captureAppError } from "@/services/observability.service";

export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = "Error inesperado";
  let message = "Algo fallo cargando esta pagina.";

  if (isRouteErrorResponse(error)) {
    title = `Error ${error.status}`;
    message = error.statusText || message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  useEffect(() => {
    captureAppError(error, {
      source: "route",
      metadata: { title, message },
    });
  }, [error, message, title]);

  return (
    <main className="grid min-h-screen place-content-center p-6">
      <Card className="max-w-lg space-y-2 text-center">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm text-zinc-300">{message}</p>
      </Card>
    </main>
  );
}

