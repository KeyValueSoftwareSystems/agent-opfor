import { useState } from "react";
import { StatusBar } from "./components/StatusBar";
import { ThreadTree } from "./components/ThreadTree";
import { ConversationView } from "./components/ConversationView";
import { FindingsPanel } from "./components/FindingsPanel";
import { SetupPage } from "./components/SetupPage";
import { useRunState } from "./hooks/useRunState";

export function App() {
  const {
    state,
    connected,
    outcome,
    selectedThreadId,
    selectedThread,
    followLive,
    setSelectedThreadId,
    setFollowLive,
  } = useRunState();

  const [showSetup, setShowSetup] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("setup") === "1";
  });

  if (showSetup) {
    return <SetupPage onStart={() => setShowSetup(false)} />;
  }

  return (
    <div className="app">
      <StatusBar state={state} connected={connected} outcome={outcome} />
      <div className="layout">
        <aside className="sidebar">
          <ThreadTree
            threads={state.threads}
            findings={state.findings}
            selectedThreadId={selectedThreadId}
            onSelect={setSelectedThreadId}
            followLive={followLive}
            onFollowLiveChange={setFollowLive}
          />
        </aside>
        <main className="main-panel">
          <ConversationView thread={selectedThread} findings={state.findings} />
        </main>
        <aside className="findings-sidebar">
          <FindingsPanel
            findings={state.findings}
            selectedThreadId={selectedThreadId}
            onSelectThread={setSelectedThreadId}
          />
        </aside>
      </div>
    </div>
  );
}
