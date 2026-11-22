"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, User } from "lucide-react";

import { MessageBubble } from "@/components/MessageBubble";

const NEAR_BOTTOM_PX = 64;

export type ChatListMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function isNearBottom(container: HTMLElement) {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= NEAR_BOTTOM_PX;
}

function ChatAvatar({ role }: { role: ChatListMessage["role"] }) {
  const mine = role === "user";
  const Icon = mine ? User : Bot;
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
        mine ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
      }`}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

export function MessageList({
  messages,
  loading,
}: {
  messages: ChatListMessage[];
  loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastScrollTop = useRef(0);
  const seenUserId = useRef<string | null>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  const latest = messages[messages.length - 1];
  const thinking = loading && latest?.role === "assistant" && latest.content.length === 0;
  const visibleMessages = thinking ? messages.slice(0, -1) : messages;

  useEffect(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "user") continue;
      if (message.id !== seenUserId.current) {
        seenUserId.current = message.id;
        stickRef.current = true;
        setIsAutoScroll(true);
      }
      break;
    }
  }, [messages]);

  useEffect(() => {
    if (!isAutoScroll) return;
    if (messages.length === 0 && !loading) return;

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container || !stickRef.current) return;
      const previous = container.style.scrollBehavior;
      container.style.scrollBehavior = "auto";
      container.scrollTop = container.scrollHeight;
      container.style.scrollBehavior = previous;
      lastScrollTop.current = container.scrollTop;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, loading, isAutoScroll]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    const scrolledUp = container.scrollTop < lastScrollTop.current - 8;
    lastScrollTop.current = container.scrollTop;
    const near = isNearBottom(container);
    if (scrolledUp && !near) {
      stickRef.current = false;
      setIsAutoScroll(false);
      return;
    }
    if (near) {
      stickRef.current = true;
      setIsAutoScroll(true);
    }
  }

  function scrollToBottom() {
    const container = containerRef.current;
    stickRef.current = true;
    setIsAutoScroll(true);
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    lastScrollTop.current = container.scrollTop;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="review-scroll absolute inset-0 flex flex-col gap-3 overflow-x-hidden overflow-y-auto scroll-smooth px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-sm text-slate-500 dark:text-slate-400">可以问助教：这个概念怎么考？</p>
        ) : (
          visibleMessages.map((message) => {
            const mine = message.role === "user";
            const streaming = loading && message.role === "assistant" && message.id === latest?.id;
            return (
              <div
                key={message.id}
                className={`flex w-full items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}
              >
                {mine ? null : <ChatAvatar role="assistant" />}
                <MessageBubble role={message.role} content={message.content} streaming={streaming} />
                {mine ? <ChatAvatar role="user" /> : null}
              </div>
            );
          })
        )}
        {thinking ? (
          <div className="flex w-full items-start justify-start gap-2" aria-live="polite">
            <ChatAvatar role="assistant" />
            <div className="mr-auto flex w-fit items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2.5 text-sm text-gray-800 dark:bg-slate-800 dark:text-slate-200">
              <span>AI 正在思考...</span>
              <span className="inline-flex items-end gap-1" aria-hidden="true">
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        ) : null}
      </div>
      {isAutoScroll || messages.length === 0 ? null : (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-md transition-colors hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-indigo-300"
        >
          滚动到底部
        </button>
      )}
    </div>
  );
}
