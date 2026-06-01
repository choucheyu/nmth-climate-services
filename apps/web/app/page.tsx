import { redirect } from "next/navigation";
import { DEFAULT_LOCALE } from "@nmth/shared";
import { getSessionStartPath } from "../lib/sessionRedirect";

export default async function HomePage() {
  redirect(await getSessionStartPath(DEFAULT_LOCALE));
}
