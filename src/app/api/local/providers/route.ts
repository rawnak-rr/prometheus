import { NextResponse } from "next/server";

import { detectLocalProviders } from "@/lib/providers/local-provider-detection";
import type { LocalProvidersResponse } from "@/lib/providers/types";

export const runtime = "nodejs";

export async function GET() {
  const providers = await detectLocalProviders();
  const response: LocalProvidersResponse = {
    runtime: "local",
    providers,
  };

  return NextResponse.json(response);
}
