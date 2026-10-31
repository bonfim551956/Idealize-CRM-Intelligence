import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { userFromToken, SESSION_COOKIE } from "./auth";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromToken(getDb(), token);
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
