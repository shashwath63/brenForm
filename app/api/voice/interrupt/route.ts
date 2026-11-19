import { anthropic, checkPasscode, errorResponse } from "@/lib/voice/server";

// "Stop" / "cancel": halts whatever the agent is doing in the session.
export async function POST(req: Request) {
  const denied = checkPasscode(req);
  if (denied) return denied;

  try {
    const { sessionId } = await req.json();
    if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });
    await anthropic.beta.sessions.events.send(String(sessionId), {
      events: [{ type: "user.interrupt" }],
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
