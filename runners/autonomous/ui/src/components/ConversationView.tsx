import { useEffect, useRef } from "react";
import type { UiThread, UiFinding, UiThreadTurn } from "../types";

interface Props {
  thread?: UiThread;
  findings: UiFinding[];
}

function TurnCard({
  turn,
  isRecon,
  isFail,
  turnNumber,
}: {
  turn: UiThreadTurn;
  isRecon: boolean;
  isFail: boolean;
  turnNumber: number;
}) {
  return (
    <div className={`turn ${isFail ? "breach" : ""}`}>
      <div className="turn-marker">
        <span className="turn-num">{turnNumber}</span>
        {isFail && <span className="breach-dot" />}
      </div>
      <div className="turn-content">
        <div className="msg prompt">
          <div className="msg-header">
            <span className="msg-role">{isRecon ? "Probe" : "Attacker"}</span>
            {turn.persona && <span className="msg-meta">{turn.persona}</span>}
            {turn.strategy && <span className="msg-meta">{turn.strategy}</span>}
          </div>
          <div className="msg-text">{turn.prompt}</div>
        </div>
        <div className="msg response">
          <div className="msg-header">
            <span className="msg-role">Target</span>
            {typeof turn.score === "number" && (
              <span className={`score ${turn.score <= 5 ? "low" : ""}`}>{turn.score}/10</span>
            )}
          </div>
          <div className="msg-text">
            {turn.response ||
              (turn.isError ? "[error]" : turn.rateLimited ? "[rate-limited]" : "—")}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationView({ thread, findings }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const turnCount = thread?.turns.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: turnCount <= 2 ? "auto" : "smooth",
      block: "end",
    });
  }, [thread?.threadId, turnCount]);

  if (!thread) {
    return (
      <div className="conversation empty-state">
        <div className="empty-icon">💬</div>
        <p>Select a thread to view the conversation</p>
      </div>
    );
  }

  const threadFindings = findings.filter((f) => f.threadId === thread.threadId);
  const failingTurns = new Set(threadFindings.flatMap((f) => f.failingTurns ?? []));
  const isRecon = thread.threadId === "recon";

  return (
    <div className="conversation">
      <div className="conv-header">
        <div className="conv-title">
          <span className="conv-name">{thread.threadId}</span>
          {thread.vulnClassId && <span className="conv-type">{thread.vulnClassId}</span>}
        </div>
        {threadFindings.length > 0 && (
          <div className="conv-findings-badge">
            {threadFindings.length} finding{threadFindings.length > 1 ? "s" : ""}
          </div>
        )}
      </div>
      <div className="conv-scroll">
        {thread.turns.length === 0 ? (
          <p className="conv-empty">No turns yet</p>
        ) : (
          thread.turns.map((turn, i) => (
            <TurnCard
              key={turn.turnIndex}
              turn={turn}
              isRecon={isRecon}
              isFail={failingTurns.has(turn.turnIndex)}
              turnNumber={i + 1}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
