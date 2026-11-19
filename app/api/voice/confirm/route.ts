import { anthropic, checkPasscode, errorResponse } from "@/lib/voice/server";

// Answers a paused tool call with the user's spoken yes/no.
export async function POST(req: Request) {
  const denied = checkPasscode(req);
  if (denied) return denied;

  try {
    const { sessionId, toolUseId, allow } = await req.json();
    if (!sessionId || !toolUseId) {
      return Response.json({ error: "sessionId and toolUseId are required" }, { status: 400 });
    }
    await anthropic.beta.sessions.events.send(String(sessionId), {
      events: [
        {
          type: "user.tool_confirmation",
          tool_use_id: String(toolUseId),
          result: allow === true ? "allow" : "deny",
        },
      ],
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
