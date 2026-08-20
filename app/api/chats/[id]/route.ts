import { session } from "@/lib/auth/session";
import { getChat, listMessages } from "@/lib/db/queries";
import { json, notFound, route } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, ctx: Ctx) => {
  const { userId } = await session(req);
  const { id } = await ctx.params;

  const chat = await getChat(userId, id);
  if (!chat) throw notFound();

  return json({ chat, messages: await listMessages(userId, id) });
});
