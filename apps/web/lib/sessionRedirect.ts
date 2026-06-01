import { cookies } from "next/headers";

const SESSION_COOKIE_NAMES = ["__Host-nmth_session", "nmth_session"] as const;

export async function getSessionStartPath(locale: string): Promise<string> {
  const cookieStore = await cookies();
  const hasSession = SESSION_COOKIE_NAMES.some((name) => Boolean(cookieStore.get(name)?.value));
  return `/${locale}/${hasSession ? "dashboard" : "login"}`;
}
