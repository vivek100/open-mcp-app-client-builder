import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = (await req.json()) as { workspaceId?: string };
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const provider = getProvider();
    const { downloadUrl } = await provider.prepareDownload(workspaceId);
    return NextResponse.json({ downloadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[workspace/download]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
