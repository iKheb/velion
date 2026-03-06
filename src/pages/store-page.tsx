import { PageHeader } from "@/components/ui/page-header";
import { StreamMonetization } from "@/features/streaming/stream-monetization";
import { ModuleErrorBoundary } from "@/components/module-error-boundary";

export default function StorePage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Tienda" subtitle="Administra creditos, compras y promociones de tu canal." />
      <ModuleErrorBoundary moduleName="tienda"><StreamMonetization scope="mine" /></ModuleErrorBoundary>
    </section>
  );
}


