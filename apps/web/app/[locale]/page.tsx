import { redirect } from "next/navigation";
import { getSessionStartPath } from "../../lib/sessionRedirect";

export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(await getSessionStartPath(locale));
}
