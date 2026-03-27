"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useCopilotChat } from "@copilotkit/react-core";
import type { WorkspaceInfo } from "@/lib/workspace/types";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { BuilderAgentProvider } from "./components/BuilderAgentProvider";
import { McpServerManager } from "./components/McpServerManager";
import { ToolDetailModal } from "./components/ToolDetail";
import { ChatSuggestions } from "./components/ChatSuggestions";
import { LoadingSpinner, EmptyState } from "./components/shared";
import { useMcpServers } from "./components/CopilotKitProvider";
import { useMcpIntrospect, type ServerIntrospection } from "./hooks/useMcpIntrospect";
import { useToolConfigStore, type MergedToolConfig } from "./hooks/useToolConfigStore";
import {
  getHeaderDocsUrl,
  getHeaderPrimaryCtaLabel,
  getHeaderSecondaryCtaLabel,
  getHeaderSecondaryCtaUrl,
} from "./constants/branding";
import copilotKitLogo from "./image.png";

// ---------------------------------------------------------------------------
// Module-level constants — stable references, no re-render issues
// ---------------------------------------------------------------------------

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
      <TopBar />

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

function TopBar() {
  const docsUrl = getHeaderDocsUrl();
  const primaryLabel = getHeaderPrimaryCtaLabel();
  const secondaryUrl = getHeaderSecondaryCtaUrl();
  const secondaryLabel = getHeaderSecondaryCtaLabel();

  return (
    <nav className="mx-auto mb-3 flex w-full max-w-[1800px] shrink-0 items-center gap-4 border-b border-slate-200/80 pb-3">
      <div className="flex min-w-0 flex-1 items-center">
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight tracking-tight text-slate-900 sm:text-lg">
            MCP App builder
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-medium text-slate-500 sm:text-xs">Powered by</span>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 rounded-md outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400"
              aria-label="CopilotKit — open documentation"
            >
              <Image
                src={copilotKitLogo}
                alt=""
                width={copilotKitLogo.width}
                height={copilotKitLogo.height}
                className="h-[22px] w-auto max-w-[min(200px,45vw)] sm:h-7 sm:max-w-[220px]"
                priority
                sizes="(max-width: 640px) 45vw, 220px"
              />
            </a>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-indigo-200 bg-indigo-50/90 px-2.5 py-1 text-[11px] font-medium text-indigo-800 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-100 sm:px-3"
        >
          {primaryLabel}
        </a>
        <a
          href={secondaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:inline-block sm:px-3"
        >
          {secondaryLabel}
        </a>
      </div>
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
  const [mobileTab, setMobileTab] = useState<"chat" | "tools">("chat");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  /** Tool open in the detail modal (sidebar list stays compact). */
  const [detailTool, setDetailTool] = useState<MergedToolConfig | null>(null);

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

      {/* Tool list — compact rows; full detail in modal */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Tools</h3>

        {loading && mergedTools.length === 0 && <LoadingSpinner />}

        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {mergedTools.map((t) => {
            const isSelected = selectedTool === t.toolName;
            return (
              <li key={t.toolName}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectTool(t.toolName);
                    setDetailTool(t);
                    setMobileTab("tools");
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-emerald-300 bg-emerald-50/60 ring-1 ring-emerald-200/80"
                      : "border-slate-200 bg-white/90 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="block truncate text-sm font-medium text-slate-900">{t.toolName}</span>
                      {t.hasUI && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                          UI
                        </span>
                      )}
                      {t.source === "local" && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-blue-100 text-blue-700">
                          Local
                        </span>
                      )}
                      {t.isModified && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-amber-100 text-amber-700">
                          Modified
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-[11px] text-slate-500">{t.description}</span>
                  </div>
                  <svg
                    className="h-4 w-4 shrink-0 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>

        {!loading && mergedTools.length === 0 && (
          <EmptyState message="No tools yet. Add an MCP server or ask the agent to build one." />
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
    <>
    <ToolDetailModal
      tool={detailTool}
      open={detailTool !== null}
      onClose={() => setDetailTool(null)}
      onTryPrompt={(p) => {
        onTryPrompt(p);
        setMobileTab("chat");
      }}
      onPreviewDataChange={(data) => {
        if (detailTool) {
          toolStore.updateConfig(detailTool.toolName, { previewData: data });
          setDetailTool({ ...detailTool, previewData: data });
        }
      }}
    />
    <BuilderAgentProvider
      activeTool={activeTool}
      allToolNames={mergedTools.map((t) => t.toolName)}
      onAddServer={(endpoint, serverId) => setServers((prev) => [...prev, { endpoint, serverId }])}
      onRefreshServers={onRefresh}
      connectedServers={servers.map((s) => s.endpoint)}
      activeWorkspace={activeWorkspace}
      onWorkspaceChange={setActiveWorkspace}
    >
      {/*
        Single mount: chatPanel is rendered twice (mobile + desktop layouts) but only one is visible.
        Registering suggestions in each instance duplicated chips in CopilotKit.
      */}
      <ChatSuggestions />
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
                {key === "tools" ? "Tools" : "Chat"}
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
    </>
  );
}
