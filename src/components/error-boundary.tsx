import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppError } from "@/services/observability.service";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    captureAppError(error, {
      source: "boundary",
      metadata: {
        componentStack: info.componentStack,
      },
    });
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-content-center bg-velion-black p-6 text-center text-velion-text">
          <h1 className="text-2xl font-bold">Velion encontro un error</h1>
          <p className="mt-2 text-sm text-zinc-300">Recarga la app para continuar.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

