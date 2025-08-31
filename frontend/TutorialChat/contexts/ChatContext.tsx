import React, { createContext, useContext, useState } from "react";
import { useMessageStream, UseMessageStreamHelpers } from "../hooks/useMessageStream";

// Define the context shape
interface ChatContextValue extends UseMessageStreamHelpers {}

// Context default value (empty placeholder).
const ChatContext = createContext<ChatContextValue | undefined>(undefined);

// ChatContextProvider for global chat state management
export const ChatContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [streamOptions, setStreamOptions] = useState({});

  // Use the useMessageStream hook for streaming functionality
  const streamHelpers = useMessageStream({
    api: "/api/chat/reply",
    ...streamOptions,
  });

  return (
    <ChatContext.Provider value={{ ...streamHelpers }}>
      {children}
    </ChatContext.Provider>
  );
};

// Hook for accessing the ChatContext
export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatContextProvider");
  }
  return context;
};
