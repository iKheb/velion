import { PageHeader } from "@/components/ui/page-header";
import { StreamEngagementPhase } from "@/features/streaming/stream-engagement-phase";
import { StreamGrowthPhase } from "@/features/streaming/stream-growth-phase";
import { StreamVodArchivePhase } from "@/features/streaming/stream-vod-archive-phase";
import { StreamerDashboard } from "@/features/streaming/streamer-dashboard";
import { StreamingHub } from "@/features/streaming/streaming-hub";

export default function StreamingStudioPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Studio del canal" subtitle="Panel profesional para operar y crecer tu canal." />
      <StreamingHub scope="mine" />
      <StreamGrowthPhase scope="mine" />
      <StreamEngagementPhase scope="mine" />
      <StreamVodArchivePhase />
      <StreamerDashboard />
    </section>
  );
}
