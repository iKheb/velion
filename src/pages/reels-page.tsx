import { PageHeader } from "@/components/ui/page-header";
import { ReelsVertical } from "@/features/social/reels-vertical";

export default function ReelsPage() {
  return (
    <section className="space-y-4">
      <PageHeader title="Reels" subtitle="Contenido vertical recomendado para ti." />
      <ReelsVertical />
    </section>
  );
}
