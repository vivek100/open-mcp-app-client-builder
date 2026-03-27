import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/workspace";

/** E2B archive + signed URL can exceed the default 10s Vercel limit. */
export const maxDuration = 300;

type DownloadBody = {
  workspaceId?: string;
  /** When true, response is the .tar.gz bytes with Content-Disposition (no pop-up on client). */
  stream?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DownloadBody;
    const { workspaceId, stream } = body;
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const provider = getProvider();
    const { downloadUrl } = await provider.prepareDownload(workspaceId);

    if (!stream) {
      return NextResponse.json({ downloadUrl });
    }

    const upstream = await fetch(downloadUrl, { redirect: "follow" });
    if (!upstream.ok) {
      const snippet = (await upstream.text().catch(() => "")).slice(0, 200);
      console.error("[workspace/download] upstream fetch failed", upstream.status, snippet);
      return NextResponse.json(
        { error: `Failed to fetch archive from storage (${upstream.status})` },
        { status: 502 }
      );
    }

    const safeId = workspaceId.replace(/[^\w-]/g, "").slice(0, 16) || "workspace";
    const filename = `workspace-${safeId}.tar.gz`;

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[workspace/download]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
