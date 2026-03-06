import { useEffect, useState } from "react";
import { getUnreadNotificationsCount, subscribeNotificationsChanges } from "@/services/notifications.service";
import { useAppStore } from "@/store/app.store";

export const useUnreadNotificationsCount = () => {
  const profile = useAppStore((state) => state.profile);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void getUnreadNotificationsCount().then(setCount);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;

    return subscribeNotificationsChanges(profile.id, () => {
      void getUnreadNotificationsCount().then(setCount);
    });
  }, [profile?.id]);

  return count;
};
