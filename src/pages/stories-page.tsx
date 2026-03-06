import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getStories } from "@/services/social.service";

export default function StoriesPage() {
  const { data = [] } = useQuery({ queryKey: ["stories-view"], queryFn: getStories });

  return (
    <section className="space-y-4">
      <PageHeader title="Historias" subtitle="Publicaciones efimeras de 24 horas." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((story) => (
          <Card key={story.id} className="overflow-hidden p-0">
            {story.media_type === "video" ? (
              <video src={story.media_url} controls className="h-64 w-full object-cover" preload="metadata" />
            ) : (
              <img src={story.media_url} alt="story" className="h-64 w-full object-cover" loading="lazy" />
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
