"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Mail } from "lucide-react";
import { formatDateTime } from "@/lib/formatters";

interface Message {
  id: string;
  sender: string;
  recipients: string;
  sentAt: Date;
  body: string;
}

interface Thread {
  id: string;
  subject: string;
  participants: string;
  messages: Message[];
}

function MessageItem({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const senderName = message.sender.split("<")[0].trim();

  return (
    <div className="border-b border-zinc-100 last:border-0">
      <button
        className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-zinc-300">
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
          <div className="h-5 w-5 rounded-full bg-zinc-200 flex items-center justify-center text-[9px] font-semibold text-zinc-600 shrink-0">
            {senderName
              .split(" ")
              .map((n: string) => n[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-800">
                {senderName}
              </span>
              <span className="text-[10px] text-zinc-400 shrink-0">
                {formatDateTime(message.sentAt)}
              </span>
            </div>
            {!expanded && (
              <p className="text-[11px] text-zinc-400 truncate">
                {message.body.slice(0, 120)}
              </p>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 ml-12">
          <div className="text-[10px] text-zinc-400 mb-2">
            To:{" "}
            {JSON.parse(message.recipients)
              .map((r: string) => r.split("<")[0].trim())
              .join(", ")}
          </div>
          <pre className="text-xs text-zinc-700 whitespace-pre-wrap font-sans leading-relaxed">
            {message.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ThreadPanel({ threads }: { threads: Thread[] }) {
  const [openThreads, setOpenThreads] = useState<Set<string>>(
    new Set([threads[0]?.id])
  );

  function toggle(id: string) {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {threads.map((thread) => {
        const participants = JSON.parse(thread.participants) as string[];
        const isOpen = openThreads.has(thread.id);
        return (
          <div
            key={thread.id}
            className="rounded-sm border border-zinc-200 bg-white overflow-hidden"
          >
            <button
              className="w-full text-left px-4 py-3 hover:bg-zinc-50 transition-colors"
              onClick={() => toggle(thread.id)}
            >
              <div className="flex items-start gap-3">
                <Mail className="h-3.5 w-3.5 text-zinc-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 justify-between">
                    <span className="text-xs font-semibold text-zinc-800 truncate">
                      {thread.subject}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-zinc-400">
                        {thread.messages.length} messages
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3 text-zinc-400" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-zinc-400" />
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    {participants
                      .map((p: string) => p.split("<")[0].trim())
                      .join(", ")}
                  </p>
                </div>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-zinc-100">
                {thread.messages.map((msg) => (
                  <MessageItem key={msg.id} message={msg} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
