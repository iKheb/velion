import { useEffect, useState } from "react";
import { getUnreadMessagesCount, subscribeUnreadMessagesChanges } from "@/services/chat.service";
import { useAppStore } from "@/store/app.store";

export const useUnreadMessagesCount = () => {
  const profile = useAppStore((state) => state.profile);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void getUnreadMessagesCount().then(setCount);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;

    return subscribeUnreadMessagesChanges(profile.id, () => {
      void getUnreadMessagesCount().then(setCount);
    });
  }, [profile?.id]);

  return count;
};
