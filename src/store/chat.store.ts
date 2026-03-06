import { create } from "zustand";
import type { ChatMessage } from "@/types/models";

const isSameMessages = (a: ChatMessage[], b: ChatMessage[]): boolean => {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].content !== b[i].content || a[i].created_at !== b[i].created_at) {
      return false;
    }
  }

  return true;
};

interface ChatState {
  typingByConversation: Record<string, boolean>;
  latestMessages: Record<string, ChatMessage[]>;
  setTyping: (conversationId: string, value: boolean) => void;
  setConversationMessages: (conversationId: string, messages: ChatMessage[]) => void;
  upsertMessage: (message: ChatMessage) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  typingByConversation: {},
  latestMessages: {},
  setTyping: (conversationId, value) =>
    set((state) => ({
      typingByConversation: { ...state.typingByConversation, [conversationId]: value },
    })),
  setConversationMessages: (conversationId, messages) =>
    set((state) => {
      const next = messages.slice(-30);
      const current = state.latestMessages[conversationId] ?? [];

      if (isSameMessages(current, next)) {
        return state;
      }

      return {
        latestMessages: {
          ...state.latestMessages,
          [conversationId]: next,
        },
      };
    }),
  upsertMessage: (message) =>
    set((state) => {
      const current = state.latestMessages[message.conversation_id] ?? [];
      const existingIndex = current.findIndex((item) => item.id === message.id);

      if (existingIndex >= 0) {
        const updated = [...current];
        updated[existingIndex] = message;
        return {
          latestMessages: {
            ...state.latestMessages,
            [message.conversation_id]: updated.slice(-30),
          },
        };
      }

      return {
        latestMessages: {
          ...state.latestMessages,
          [message.conversation_id]: [...current.slice(-29), message],
        },
      };
    }),
}));
