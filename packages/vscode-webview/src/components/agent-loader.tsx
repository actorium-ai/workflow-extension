interface AgentLoaderProps {
  seconds: number;
}

export function AgentLoader({ seconds }: AgentLoaderProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-1 py-0.5 text-text-secondary"
      aria-label="Agent is responding"
    >
      <span className="animate-chat-bounce h-1 w-1 rounded-full bg-text-secondary [animation-delay:0s]" />
      <span className="animate-chat-bounce h-1 w-1 rounded-full bg-text-secondary [animation-delay:0.15s]" />
      <span className="animate-chat-bounce h-1 w-1 rounded-full bg-text-secondary [animation-delay:0.3s]" />
      {seconds > 0 && <span className="text-[11px] tabular-nums opacity-70">{seconds}s</span>}
    </div>
  );
}
