import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { captureAppError } from "@/services/observability.service";

interface ModuleErrorBoundaryProps {
  moduleName: string;
  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  hasError: boolean;
}

export class ModuleErrorBoundary extends Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
  public state: ModuleErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ModuleErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    captureAppError(error, {
      source: "boundary",
      metadata: {
        module: this.props.moduleName,
        componentStack: info.componentStack,
      },
    });
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Card className="text-center">
          <p className="text-sm font-semibold text-zinc-100">Error en {this.props.moduleName}</p>
          <p className="mt-1 text-xs text-zinc-400">Recarga la vista para continuar.</p>
        </Card>
      );
    }

    return this.props.children;
  }
}
