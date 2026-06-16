import type { UiThread, UiFinding } from "../types";

interface Props {
  threads: UiThread[];
  findings: UiFinding[];
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  followLive: boolean;
  onFollowLiveChange: (follow: boolean) => void;
}

interface TreeNode {
  thread: UiThread;
  children: TreeNode[];
  depth: number;
}

function severityForThread(threadId: string, findings: UiFinding[]): string | null {
  const order = ["critical", "high", "medium", "low"];
  const related = findings.filter((f) => f.threadId === threadId);
  if (!related.length) return null;
  related.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return related[0].severity;
}

function buildTreeNodes(threads: UiThread[]): TreeNode[] {
  const childrenOf = new Map<string | undefined, UiThread[]>();

  for (const t of threads) {
    const key = t.parentThreadId;
    const list = childrenOf.get(key) ?? [];
    list.push(t);
    childrenOf.set(key, list);
  }

  function buildNode(thread: UiThread, depth: number): TreeNode {
    const children = (childrenOf.get(thread.threadId) ?? []).map((c) => buildNode(c, depth + 1));
    return { thread, children, depth };
  }

  const roots = childrenOf.get(undefined) ?? [];
  return roots.map((r) => buildNode(r, 0));
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(node: TreeNode) {
    result.push(node);
    for (const child of node.children) walk(child);
  }
  for (const node of nodes) walk(node);
  return result;
}

function ThreadItem({
  node,
  findings,
  selectedThreadId,
  onSelect,
}: {
  node: TreeNode;
  findings: UiFinding[];
  selectedThreadId?: string;
  onSelect: (id: string) => void;
}) {
  const { thread, depth } = node;
  const sev = severityForThread(thread.threadId, findings);
  const shortId = thread.threadId.split("/").pop() ?? thread.threadId;
  const isSelected = selectedThreadId === thread.threadId;
  const hasFinding = sev !== null;

  return (
    <button
      type="button"
      className={`thread-item ${isSelected ? "selected" : ""} ${hasFinding ? `has-finding sev-${sev}` : ""}`}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
      onClick={() => onSelect(thread.threadId)}
      title={thread.threadId}
    >
      {depth > 0 && <span className="tree-indent">└</span>}
      {hasFinding && <span className={`sev-dot sev-${sev}`} />}
      <span className="thread-name">{shortId}</span>
      <span className="thread-turns">{thread.turnCount}</span>
    </button>
  );
}

export function ThreadTree({
  threads,
  findings,
  selectedThreadId,
  onSelect,
  followLive,
  onFollowLiveChange,
}: Props) {
  const recon = threads.filter((t) => t.threadId === "recon");
  const attacks = threads.filter((t) => t.threadId !== "recon");
  const attackTree = buildTreeNodes(attacks);
  const flatAttacks = flattenTree(attackTree);
  const flatRecon = recon.map((t) => ({ thread: t, children: [], depth: 0 }));

  const totalFindings = findings.length;
  const critCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  return (
    <div className="thread-tree">
      <div className="tree-header">
        <span className="tree-title">Threads</span>
        <div className="tree-header-right">
          {totalFindings > 0 && (
            <div className="tree-badges">
              {critCount > 0 && <span className="badge crit">{critCount}</span>}
              {highCount > 0 && <span className="badge high">{highCount}</span>}
              {totalFindings - critCount - highCount > 0 && (
                <span className="badge med">{totalFindings - critCount - highCount}</span>
              )}
            </div>
          )}
          <label className="follow-toggle" title="Auto-follow">
            <input
              type="checkbox"
              checked={followLive}
              onChange={(e) => onFollowLiveChange(e.target.checked)}
            />
          </label>
        </div>
      </div>

      <div className="thread-list">
        {flatAttacks.length === 0 && flatRecon.length === 0 ? (
          <div className="tree-empty">
            <div className="empty-spinner" />
          </div>
        ) : (
          <>
            {flatAttacks.map((node) => (
              <ThreadItem
                key={node.thread.threadId}
                node={node}
                findings={findings}
                selectedThreadId={selectedThreadId}
                onSelect={onSelect}
              />
            ))}
            {flatRecon.length > 0 && flatAttacks.length > 0 && <div className="section-divider" />}
            {flatRecon.map((node) => (
              <ThreadItem
                key={node.thread.threadId}
                node={node}
                findings={findings}
                selectedThreadId={selectedThreadId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
