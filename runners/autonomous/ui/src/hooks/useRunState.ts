import { useCallback, useEffect, useState } from "react";
import type { SsePayload, UiRunState } from "../types";

const EMPTY_STATE: UiRunState = {
  runId: "pending",
  phase: "boot",
  startedAt: new Date().toISOString(),
  objective: "",
  targetName: "Connecting…",
  targetEndpoint: "",
  completed: false,
  truncated: false,
  summary: { threads: 0, findings: 0, leads: 0, turns: 0 },
  threads: [],
  findings: [],
};

async function fetchState(): Promise<UiRunState | null> {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) return null;
    return (await r.json()) as UiRunState;
  } catch {
    return null;
  }
}

async function fetchLines(): Promise<string[] | null> {
  try {
    const r = await fetch("/api/lines");
    if (!r.ok) return null;
    const data = (await r.json()) as { lines: string[] };
    return data.lines ?? [];
  } catch {
    return null;
  }
}

function pickLiveThread(state: UiRunState, preferredId?: string): string | undefined {
  if (preferredId && state.threads.some((t) => t.threadId === preferredId)) {
    return preferredId;
  }
  const attacks = state.threads
    .filter((t) => t.threadId !== "recon" && t.turnCount > 0)
    .sort((a, b) => b.turnCount - a.turnCount);
  if (attacks[0]) return attacks[0].threadId;
  const any = state.threads
    .filter((t) => t.turnCount > 0)
    .sort((a, b) => b.turnCount - a.turnCount);
  if (any[0]) return any[0].threadId;
  return state.threads.find((t) => t.threadId !== "recon")?.threadId ?? state.threads[0]?.threadId;
}

export function useRunState() {
  const [state, setState] = useState<UiRunState>(EMPTY_STATE);
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [outcome, setOutcome] = useState<string | undefined>();
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [followLive, setFollowLive] = useState(true);

  const applyPayload = useCallback(
    (payload: SsePayload) => {
      if (payload.kind === "line") {
        setLines((prev) => [...prev.slice(-499), payload.line]);
      } else if (payload.kind === "event") {
        const { event } = payload;
        if (
          followLive &&
          event.threadId &&
          event.threadId !== "recon" &&
          (event.type === "turn" || event.type === "thread_created" || event.type === "finding")
        ) {
          setSelectedThreadId(event.threadId);
        }
      } else if (payload.kind === "state") {
        setState(payload.state);
        if (followLive) {
          setSelectedThreadId(pickLiveThread(payload.state));
        } else {
          setSelectedThreadId((cur) => pickLiveThread(payload.state, cur));
        }
      } else if (payload.kind === "complete") {
        setOutcome(payload.outcome);
      }
    },
    [followLive]
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const [data, logLines] = await Promise.all([fetchState(), fetchLines()]);
      if (cancelled) return;
      if (data) {
        setState(data);
        if (followLive) {
          setSelectedThreadId(pickLiveThread(data));
        } else {
          setSelectedThreadId((cur) => pickLiveThread(data, cur));
        }
      }
      if (logLines) setLines(logLines);
    };

    void refresh();
    const poll = setInterval(() => void refresh(), 2000);

    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        applyPayload(JSON.parse(ev.data) as SsePayload);
      } catch {
        /* ignore malformed */
      }
    };

    return () => {
      cancelled = true;
      clearInterval(poll);
      es.close();
    };
  }, [applyPayload, followLive]);

  const selectedThread = state.threads.find((t) => t.threadId === selectedThreadId);

  return {
    state,
    lines,
    connected,
    outcome,
    selectedThreadId,
    selectedThread,
    followLive,
    setSelectedThreadId: (id: string) => {
      setFollowLive(false);
      setSelectedThreadId(id);
    },
    setFollowLive,
  };
}
