# Feedback: Widget Images Missing in Chat — CSP `base-uri` Conflict

## The Problem

MCP-use widgets render correctly in the **tool preview** (Studio playground) but images fail to load when the widget is rendered **in chat** via CopilotKit's `MCPAppsRenderer`.

Browser console error:
```
Setting the document's base URI to 'http://localhost:3109/' violates the following
Content Security Policy directive: 'base-uri 'self''.
```

## Root Cause: Three-Layer CSP Conflict

### Layer 1 — `@copilotkitnext/react` SANDBOX_HTML (hardcoded CSP)

`MCPAppsRenderer` renders widgets inside a sandboxed iframe whose outer HTML is hardcoded with:

```html
<meta http-equiv="Content-Security-Policy"
  content="... base-uri 'self'; ..." />
```

This is not configurable. It restricts the `<base>` tag to same-origin URIs only.

### Layer 2 — Inner widget iframe inherits the CSP

The SANDBOX_HTML creates a second (inner) iframe for the actual widget HTML with:

```html
<iframe sandbox="allow-scripts allow-same-origin ...">
```

`allow-same-origin` causes the inner iframe to inherit the **parent's CSP**, including `base-uri 'self'`.

### Layer 3 — mcp-use server injects `<base href="http://localhost:3109">`

The mcp-use server's `processWidgetHtml()` function always injects a `<base>` tag pointing to the server's origin when serving widget resources:

```html
<base href="http://localhost:3109" />  <!-- violates inherited base-uri 'self' -->
```

This tag is **not needed** — all script/CSS assets are already absolute URLs, and the `Image` component resolves relative paths using `window.__mcpPublicUrl = "http://localhost:3109/mcp-use/public"` which works fine without a `<base>` tag.

### Why Three.js Widget Is Unaffected

The three.js widget is a **single self-contained HTML file** with no `<base>` tag and no external asset references. The mcp-use widget uses a Vite-built bundle with multiple assets and the `Image` component — hence the injection.

---

## What Was Investigated

### `CSPConfig.baseUriDomains` on mcp-use widget metadata

mcp-use exposes a `csp.baseUriDomains` field in widget metadata:

```typescript
server.widget({
  metadata: {
    csp: { baseUriDomains: ['http://localhost:3109'] }
  }
});
```

**This does not fix the problem.** This field controls the CSP that mcp-use adds to its own HTTP responses. It has no effect on the `base-uri 'self'` hardcoded inside `@copilotkitnext/react`'s SANDBOX_HTML, which is what the inner iframe actually inherits.

### mcp-use `MCPServer` `baseUrl` option

There is no option to disable `<base>` tag injection. The `processWidgetHtml()` function in mcp-use always injects the tag when a `baseUrl` is available (which it always is, computed from `host:port` if not explicitly configured).

### `@copilotkitnext/react` SANDBOX_HTML

The CSP is hardcoded in the compiled JS bundle. Not configurable via props or environment variables.

---

## How `@mcp-ui/client` Solves This (Reference)

The official `@mcp-ui/client` SDK (`AppRenderer`) uses a **proxy + `document.write()`** approach:

```
Host Page
  └─ Proxy iframe (different origin, static HTML file)
       └─ Inner iframe (src="about:blank")
            └─ HTML injected via document.write()
```

Their source comment explicitly states:
> *"The new implementation uses document.write() instead of srcdoc, which avoids CSP base-uri issues."*

`document.write()` into a same-origin `about:blank` frame does not trigger `base-uri` CSP enforcement. This is the correct long-term approach for any MCP Apps host.

---

## Implemented Fix: Strip `<base>` Tags in Middleware

Since the `<base>` tag is unnecessary (assets are already absolute, `Image` uses `window.__mcpPublicUrl`), we strip it from widget HTML in the `resources/read` response before it reaches the SANDBOX iframe.

### Where the fix lives

`MCPAppsMiddlewareStripBase` in `apps/web/app/api/copilotkit/route.ts` — a thin subclass of `MCPAppsMiddleware` that intercepts `RUN_FINISHED` events on proxied `resources/read` requests and removes `<base>` tags from the HTML text content.

```ts
class MCPAppsMiddlewareStripBase extends MCPAppsMiddleware {
  run(input: any, next: any): Observable<any> {
    const source = super.run(input, next);
    const isResourceRead =
      (input as any).forwardedProps?.__proxiedMCPRequest?.method === "resources/read";
    if (!isResourceRead) return source;

    return new Observable((observer) => {
      source.subscribe({
        next(event: any) {
          if (event.type === "RUN_FINISHED" && Array.isArray(event.result?.contents)) {
            const contents = event.result.contents.map((c: any) => {
              if (typeof c.text === "string") {
                return { ...c, text: c.text.replace(/<base\b[^>]*>/gi, "") };
              }
              return c;
            });
            observer.next({ ...event, result: { ...event.result, contents } });
          } else {
            observer.next(event);
          }
        },
        error: (err: any) => observer.error(err),
        complete: () => observer.complete(),
      });
    });
  }
}
```

**Result:** Widget HTML reaches the SANDBOX iframe without a `<base>` tag. Images resolve correctly via `window.__mcpPublicUrl`. No CSP violation.

---

## Upstream Issues to File

### 1. `@copilotkitnext/react` — Switch from `srcdoc` to `document.write()`

The SANDBOX_HTML should use `document.write()` into a same-origin inner iframe (like `@mcp-ui/client` does) instead of `srcdoc`. This eliminates the `base-uri` inheritance problem entirely and makes the sandbox compatible with any HTML that uses a `<base>` tag.

**File as:** Feature request — adopt `document.write()` proxy pattern for widget HTML injection.

### 2. mcp-use — Add `noBaseTag` server config option

`MCPServer` should support an option to skip `<base>` tag injection for deployments where assets are already absolute:

```typescript
const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  noBaseTag: true, // don't inject <base href="..."> into widget HTML
});
```

This would be useful for any host with strict `base-uri` policies (not just CopilotKit).

**File as:** Feature request — `noBaseTag` / `injectBaseTag: false` config option.
