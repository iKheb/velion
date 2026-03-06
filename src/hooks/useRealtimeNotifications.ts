import { useEffect, useState } from "react";
import type { NotificationItem } from "@/types/models";
import { getNotificationById, getNotifications, subscribeNotifications } from "@/services/notifications.service";
import { useAppStore } from "@/store/app.store";

export const useRealtimeNotifications = () => {
  const profile = useAppStore((state) => state.profile);
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    void getNotifications().then(setItems);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;

    return subscribeNotifications(profile.id, (item) => {
      void (async () => {
        const hydratedItem = await getNotificationById(item.id);
        setItems((prev) => [hydratedItem ?? item, ...prev]);
      })();
    });
  }, [profile?.id]);

  return items;
};

