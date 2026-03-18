"use client";

import { useState, useEffect, useCallback } from "react";
import { McpAppPreview } from "./McpAppPreview";
import type { MergedToolConfig } from "../hooks/useToolConfigStore";

type DetailTab = "info" | "data" | "json" | "ui" | "schema";

/**
 * Inline tool detail panel — rendered in the left sidebar when a tool is selected.
 * Replaces the old right-column ArtifactInspector.
 * Shows: preview (if hasUI), try-prompt suggestions, then tabbed detail.
 */
export function ToolDetail({
  tool,
  onTryPrompt,
  onPreviewDataChange,
  hideHeader = false,
  mergedWithHeader = false,
}: {
  tool: MergedToolConfig;
  onTryPrompt: (prompt: string) => void;
  onPreviewDataChange: (data: Record<string, unknown>) => void;
  hideHeader?: boolean;
  /** When true, render as the body of a single card (no outer border, connects to header above). */
  mergedWithHeader?: boolean;
}) {
  const [tab, setTab] = useState<DetailTab>("info");
  const [previewJson, setPreviewJson] = useState(JSON.stringify(tool.previewData, null, 2));
  const [previewJsonError, setPreviewJsonError] = useState<string | null>(null);

  useEffect(() => {
    setPreviewJson(JSON.stringify(tool.previewData, null, 2));
    setPreviewJsonError(null);
  }, [tool.previewData]);

  const savePreviewData = useCallback(() => {
    try {
      const parsed = JSON.parse(previewJson);
      onPreviewDataChange(parsed);
      setPreviewJsonError(null);
    } catch (e) {
      setPreviewJsonError((e as Error).message);
    }
  }, [previewJson, onPreviewDataChange]);

  const params = Object.entries(
    ((tool.inputSchema as Record<string, unknown>)?.properties as Record<
      string,
      { type?: string; description?: string }
    >) ?? {}
  );
  const required = ((tool.inputSchema as Record<string, unknown>)?.required as string[]) ?? [];

  const paramKeys = params.map(([k]) => k);
  const tryPrompts =
    paramKeys.length > 0
      ? paramKeys.slice(0, 2).map((k) => `Use ${tool.toolName} with ${k}: "example"`)
      : [`Use the ${tool.toolName} tool`];

  const toolJson = JSON.stringify(
    { name: tool.toolName, description: tool.description, inputSchema: tool.inputSchema, _meta: tool._meta },
    null,
    2
  );

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "info", label: "Overview" },
    { key: "data", label: "Preview Data" },
    { key: "json", label: "JSON" },
    ...(tool.htmlSource ? [{ key: "ui" as const, label: "Source" }] : []),
    { key: "schema", label: "Schema" },
  ];

  return (
    <div
      className={
        mergedWithHeader
          ? "flex flex-col gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50/70 p-3"
          : "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/60 p-3"
      }
    >
      {/* Header — hidden when rendered inline under the tool list button */}
      {!hideHeader && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{tool.toolName}</p>
            <p className="truncate text-[11px] text-slate-500">{tool.description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            {tool.hasUI && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                UI
              </span>
            )}
            {tool.source === "local" && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
                Local
              </span>
            )}
            {tool.isModified && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                Modified
              </span>
            )}
          </div>
        </div>
      )}

      {/* Live preview */}
      {tool.hasUI && (
        <McpAppPreview
          toolName={tool.toolName}
          toolDescription={tool.description}
          inputSchema={tool.inputSchema}
          htmlSource={tool.htmlSource}
          hasUI={tool.hasUI}
          previewData={tool.previewData}
          height="220px"
        />
      )}

      {/* Try-prompt suggestions */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Try in chat
        </p>
        {tryPrompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onTryPrompt(p)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
          >
            ▶ {p}
          </button>
        ))}
      </div>

      {/* Detail tabs */}
      <div className="flex flex-col gap-2">
        <nav className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                tab === t.key
                  ? "rounded-lg bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white"
                  : "rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        {tab === "info" && (
          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            {params.length > 0 ? (
              params.map(([name, meta]) => (
                <div key={name} className="flex flex-wrap items-start gap-1.5">
                  <code className="text-[11px] font-semibold text-slate-800">{name}</code>
                  {required.includes(name) && (
                    <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
                      required
                    </span>
                  )}
                  <span className="rounded bg-slate-200/70 px-1 py-0.5 text-[9px] font-medium text-slate-500">
                    {meta?.type ?? "any"}
                  </span>
                  {meta?.description && (
                    <span className="w-full text-[10px] text-slate-500">{meta.description}</span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400">No parameters</p>
            )}
            {tool.hasUI && tool.uiResourceUri && (
              <div className="mt-2 border-t border-slate-200 pt-2">
                <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                  UI Resource
                </p>
                <code className="text-[10px] text-slate-600">{tool.uiResourceUri}</code>
                {tool.htmlSource && (
                  <span className="ml-2 text-[10px] text-slate-400">
                    {(tool.htmlSource.length / 1024).toFixed(1)} KB
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "data" && (
          <div className="flex flex-col gap-1.5">
            {previewJsonError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
                {previewJsonError}
              </div>
            )}
            <textarea
              value={previewJson}
              onChange={(e) => setPreviewJson(e.target.value)}
              className="h-36 resize-none rounded-lg bg-slate-950 p-2.5 font-mono text-[10px] leading-relaxed text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-600"
              spellCheck={false}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onPreviewDataChange({})}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:border-slate-300"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={savePreviewData}
                className="rounded-lg bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {(tab === "json" || tab === "ui" || tab === "schema") && (
          <div className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-2.5">
            <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-slate-100">
              {tab === "json" && toolJson}
              {tab === "ui" && (tool.htmlSource ?? "No UI source")}
              {tab === "schema" && JSON.stringify(tool.inputSchema, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
