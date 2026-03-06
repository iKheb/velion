import { create } from "zustand";
import type { Profile } from "@/types/models";

interface AppState {
  profile: Profile | null;
  isDarkMode: boolean;
  soundsEnabled: boolean;
  setProfile: (profile: Profile | null) => void;
  toggleSounds: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  profile: null,
  isDarkMode: true,
  soundsEnabled: false,
  setProfile: (profile) => set({ profile }),
  toggleSounds: () => set((state) => ({ soundsEnabled: !state.soundsEnabled })),
}));

