"use client";

import { useState, useEffect } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useCopilotChat } from "@copilotkit/react-core";
import type { WorkspaceInfo } from "@/lib/workspace/types";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { BuilderAgentProvider } from "./components/BuilderAgentProvider";
import { McpServerManager } from "./components/McpServerManager";
import { ToolDetail } from "./components/ToolDetail";
import { LoadingSpinner, EmptyState, CreateToolForm } from "./components/shared";
import { useMcpServers } from "./components/CopilotKitProvider";
import { useMcpIntrospect, type ServerIntrospection } from "./hooks/useMcpIntrospect";
import { useToolConfigStore, type MergedToolConfig } from "./hooks/useToolConfigStore";

// ---------------------------------------------------------------------------
// Module-level constants — stable references, no re-render issues
// ---------------------------------------------------------------------------

const STARTER_PROMPTS = [
  "Build a crypto price widget",
  "Build a weather dashboard widget",
  "Build a stock chart widget",
];

const CHAT_LABELS = {
  chatInputPlaceholder: "Ask me to build a widget or add an MCP server…",
  welcomeMessageText:
    "Hi! I'm the MCP App builder. Add an MCP server in the sidebar, or ask me to build a widget.",
} as const;

// ---------------------------------------------------------------------------
// Main page — owns top-level state, delegates rendering to StudioView
// ---------------------------------------------------------------------------

export default function CopilotKitPage() {
  const [selectedTool, setSelectedTool] = useState<string>("");
  const { appendMessage } = useCopilotChat();

  const { servers } = useMcpServers();
  const { allTools, data: serverData, loading, refresh } = useMcpIntrospect(servers);
  const toolStore = useToolConfigStore(allTools);

  const activeTool =
    toolStore.mergedTools.find((t) => t.toolName === selectedTool) ??
    toolStore.mergedTools[0] ??
    null;

  const handleTryPrompt = (prompt: string) => {
    appendMessage(new TextMessage({ content: prompt, role: Role.User }));
  };

  return (
    <main className="app-shell flex h-screen w-screen flex-col overflow-hidden p-2 sm:p-3 md:p-4">
      <TopBar toolCount={toolStore.mergedTools.length} loading={loading} onRefresh={refresh} />

      <div className="mx-auto min-h-0 w-full max-w-[1800px] flex-1">
        <StudioView
          mergedTools={toolStore.mergedTools}
          activeTool={activeTool}
          selectedTool={selectedTool || activeTool?.toolName || ""}
          onSelectTool={setSelectedTool}
          onTryPrompt={handleTryPrompt}
          loading={loading}
          serverData={serverData}
          onRefresh={refresh}
          toolStore={toolStore}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({
  toolCount,
  loading,
  onRefresh,
}: {
  toolCount: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <nav className="mx-auto mb-3 flex w-full max-w-[1800px] shrink-0 items-center gap-2">
      <span className="mr-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        MCP App builder
      </span>
      <div className="flex-1" />

      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
      >
        {loading ? "Syncing\u2026" : "Refresh"}
      </button>
      <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-500">
        {toolCount} tool{toolCount !== 1 ? "s" : ""}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live
      </span>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Studio — 2-column layout: left sidebar + chat
// Left sidebar: servers + tool list (top) / tool detail with preview + prompts (bottom)
// ---------------------------------------------------------------------------

function StudioView({
  mergedTools,
  activeTool,
  selectedTool,
  onSelectTool,
  onTryPrompt,
  loading,
  serverData,
  onRefresh,
  toolStore,
}: {
  mergedTools: MergedToolConfig[];
  activeTool: MergedToolConfig | null;
  selectedTool: string;
  onSelectTool: (name: string) => void;
  onTryPrompt: (prompt: string) => void;
  loading: boolean;
  serverData: ServerIntrospection[];
  onRefresh: () => void;
  toolStore: ReturnType<typeof useToolConfigStore>;
}) {
  const { servers, setServers } = useMcpServers();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "tools">("chat");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);

  // On mount: restore the last workspace from localStorage so the user doesn't
  // have to re-provision a new E2B sandbox on every page reload.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("mcp_active_workspace");
      if (!raw) return;
      const { workspaceId, endpoint, serverId } = JSON.parse(raw) as {
        workspaceId?: string;
        endpoint?: string;
        serverId?: string;
      };
      if (!workspaceId || !endpoint) return;

      fetch("/api/workspace/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (!info) {
            localStorage.removeItem("mcp_active_workspace");
            return;
          }
          const liveEndpoint: string = info.endpoint ?? endpoint;
          setActiveWorkspace({ workspaceId, endpoint: liveEndpoint, status: "running", path: "/home/user/workspace" });
          setServers((prev) => {
            if (prev.some((s) => s.endpoint === liveEndpoint)) return prev;
            return [...prev, { endpoint: liveEndpoint, serverId: serverId ?? "workspace" }];
          });
        })
        .catch(() => localStorage.removeItem("mcp_active_workspace"));
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateTool = (name: string, description: string) => {
    toolStore.createTool(name, description, {
      type: "object",
      properties: { input: { type: "string", description: "Input value" } },
      required: ["input"],
    });
    onSelectTool(name);
    setShowCreateForm(false);
  };

  // Shared sidebar content — used in both mobile and desktop layouts
  const sidebarContent = (
    <>
      {/* Servers — errors and Reconnect are shown per-server in the list */}
      <section className="shrink-0 rounded-2xl border border-slate-200 bg-white p-3">
        <McpServerManager
          activeWorkspace={activeWorkspace}
          serverStatuses={serverData}
          onReconnect={onRefresh}
          globalLoading={loading}
        />
      </section>

      {/* Tool list — single scrollable section; detail expands inline under selected tool */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tools</h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="rounded-lg border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
            >
              {showCreateForm ? "Cancel" : "+ New"}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="text-[10px] font-medium text-slate-400 hover:text-slate-700 disabled:opacity-50"
            >
              {loading ? "\u2026" : "Refresh"}
            </button>
          </div>
        </div>

        {showCreateForm && (
          <div className="mb-2 shrink-0">
            <CreateToolForm onSubmit={handleCreateTool} onCancel={() => setShowCreateForm(false)} />
          </div>
        )}

        {loading && mergedTools.length === 0 && <LoadingSpinner />}

        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {mergedTools.map((t) => {
            const isSelected = selectedTool === t.toolName;
            return (
              <li key={t.toolName} className="flex flex-col">
                {isSelected ? (
                  /* Single card: header + expanded detail merged */
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTool(t.toolName);
                        setMobileTab("tools");
                      }}
                      className="w-full rounded-t-xl border-0 border-b border-slate-200 bg-slate-900 px-3 py-2.5 text-left transition hover:bg-slate-800"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="block truncate text-sm font-medium text-white">{t.toolName}</span>
                        {t.hasUI && (
                          <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-emerald-400/20 text-emerald-200">
                            UI
                          </span>
                        )}
                        {t.source === "local" && (
                          <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-blue-400/20 text-blue-200">
                            Local
                          </span>
                        )}
                        {t.isModified && (
                          <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-amber-400/20 text-amber-200">
                            Modified
                          </span>
                        )}
                      </div>
                      <span className="block truncate text-[11px] text-slate-300">{t.description}</span>
                    </button>
                    <ToolDetail
                      tool={t}
                      hideHeader
                      mergedWithHeader
                      onTryPrompt={(p) => {
                        onTryPrompt(p);
                        setMobileTab("chat");
                      }}
                      onPreviewDataChange={(data) =>
                        toolStore.updateConfig(t.toolName, { previewData: data })
                      }
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectTool(t.toolName);
                      setMobileTab("tools");
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="block truncate text-sm font-medium">{t.toolName}</span>
                      {t.hasUI && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-emerald-50 text-emerald-600">
                          UI
                        </span>
                      )}
                      {t.source === "local" && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-blue-50 text-blue-600">
                          Local
                        </span>
                      )}
                      {t.isModified && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-amber-50 text-amber-600">
                          Modified
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-[11px] text-slate-500">{t.description}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {!loading && mergedTools.length === 0 && (
          <EmptyState message="No tools yet. Create one or connect an MCP server." />
        )}
      </section>
    </>
  );

  const chatPanel = (
    <section className="glass-panel flex min-h-0 flex-1 flex-col rounded-2xl p-3 sm:p-4">
      <div className="mb-2 shrink-0">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Agent</h2>
          <p className="hidden text-xs text-slate-500 sm:block">
            {activeTool
              ? `Active: ${activeTool.toolName} \u2014 ask to use it or modify it`
              : "Select a tool, or ask the agent to create one"}
          </p>
        </div>
        {/* Starter prompt chips */}
        <div className="flex flex-wrap gap-1.5">
          {STARTER_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onTryPrompt(p)}
              className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="chat-container min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
        <CopilotChat
          className="h-full w-full"
          labels={CHAT_LABELS}
        />
      </div>
    </section>
  );

  return (
    <BuilderAgentProvider
      activeTool={activeTool}
      allToolNames={mergedTools.map((t) => t.toolName)}
      onAddServer={(endpoint, serverId) => setServers((prev) => [...prev, { endpoint, serverId }])}
      onRefreshServers={onRefresh}
      connectedServers={servers.map((s) => s.endpoint)}
      activeWorkspace={activeWorkspace}
      onWorkspaceChange={setActiveWorkspace}
    >
      {/* Mobile (<768px): 2-tab switcher */}
      <div className="mobile-layout flex h-full min-h-0 flex-col gap-2">
        <nav className="glass-panel shrink-0 rounded-2xl p-1">
          <div className="grid grid-cols-2 gap-1">
            {(["chat", "tools"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobileTab(key)}
                className={`rounded-xl px-2 py-1.5 text-[11px] font-medium capitalize transition ${
                  mobileTab === key
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white/70 text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                {key === "tools" ? "Tools & Preview" : "Chat"}
              </button>
            ))}
          </div>
        </nav>

        {mobileTab === "chat" ? (
          chatPanel
        ) : (
          <aside className="glass-panel flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl p-2.5">
            {sidebarContent}
          </aside>
        )}
      </div>

      {/* Desktop (≥768px): fixed-width sidebar + fluid chat */}
      <div
        className="desktop-layout h-full gap-3"
        style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr)" }}
      >
        <aside className="glass-panel flex min-h-0 flex-col gap-3 overflow-hidden rounded-2xl p-3">
          {sidebarContent}
        </aside>
        {chatPanel}
      </div>
    </BuilderAgentProvider>
  );
}
