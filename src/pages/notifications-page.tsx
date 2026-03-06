import { PageHeader } from "@/components/ui/page-header";
import { NotificationsPanel } from "@/features/notifications/notifications-panel";
import { ModuleErrorBoundary } from "@/components/module-error-boundary";

export default function NotificationsPage() {
  return (
    <section className="space-y-4">
      <PageHeader title="Notificaciones" subtitle="Mantente al dia con la actividad importante de tu cuenta." />
      <ModuleErrorBoundary moduleName="notificaciones"><NotificationsPanel /></ModuleErrorBoundary>
    </section>
  );
}

