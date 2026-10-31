import { cookies } from "next/headers";
import { getDb } from "@/db";
import { logout, SESSION_COOKIE } from "@/server/auth";

export async function POST(req: Request) {
  const c = await cookies();
  await logout(getDb(), c.get(SESSION_COOKIE)?.value);
  c.delete(SESSION_COOKIE);
  return Response.redirect(new URL("/login", req.url), 303);
}
