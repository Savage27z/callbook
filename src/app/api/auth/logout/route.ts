import { NextResponse } from "next/server";
import { sessionCookie } from "@/lib/auth.ts";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", sessionCookie("", 0));
  return res;
}
