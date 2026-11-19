import { anthropic, checkPasscode, errorResponse } from "@/lib/voice/server";
import type { VoiceEvent } from "@/lib/voice/types";

// Agent turns can take minutes. Raise this if your host allows longer requests;
// the browser automatically re-attaches (resume) if the stream is cut.
export const maxDuration = 300;

type ToolUseLike = { id: string; type: string; name?: string; input?: Record<string, unknown>; evaluated_permission?: string };

/** One short spoken-friendly line describing a tool call. */
function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const short = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
  switch (name) {
    case "bash":
      return `run the command: ${short(pick("command"))}`;
    case "write":
      return `write the file ${pick("file_path") || pick("path")}`;
    case "edit":
      return `edit the file ${pick("file_path") || pick("path")}`;
    case "read":
      return `read ${pick("file_path") || pick("path")}`;
    case "web_fetch":
      return `fetch ${short(pick("url"))}`;
    case "web_search":
      return `search the web for ${short(pick("query"))}`;
    default:
      return `use the ${name} tool`;
  }
}

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * POST { sessionId, text }  -> sends a voice command and streams the agent's progress back.
 * POST { sessionId }        -> re-attaches to a running session (after a dropped connection).
 * Response: newline-delimited JSON VoiceEvent objects.
 */
export async function POST(req: Request) {
  const denied = checkPasscode(req);
  if (denied) return denied;

  let sessionId: string;
  let text: string | undefined;
  try {
    const body = await req.json();
    sessionId = String(body.sessionId || "");
    text = typeof body.text === "string" && body.text.trim() ? body.text.trim() : undefined;
    if (!sessionId) throw new Error("sessionId is required");
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }

  // Stream-first: open the event stream BEFORE sending the message so no early events are missed.
  let stream;
  try {
    stream = await anthropic.beta.sessions.events.stream(sessionId);
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const seen = new Set<string>();
      let closed = false;
      const emit = (ev: VoiceEvent) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      // If the browser goes away, stop reading from the session stream.
      req.signal.addEventListener("abort", () => {
        closed = true;
        stream.controller.abort();
      });

      // Returns true when this turn is finished.
      const handle = (event: { id?: string; type: string; [k: string]: unknown }): boolean => {
        if (event.id) {
          if (seen.has(event.id)) return false;
          seen.add(event.id);
        }
        switch (event.type) {
          case "session.status_running":
            emit({ type: "status", status: "running" });
            return false;
          case "session.status_rescheduled":
            emit({ type: "status", status: "rescheduled" });
            return false;
          case "agent.message": {
            const t = textOf(event.content as Array<{ type: string; text?: string }>);
            if (t) emit({ type: "message", id: event.id ?? "", text: t });
            return false;
          }
          case "agent.tool_use":
          case "agent.mcp_tool_use": {
            const tu = event as unknown as ToolUseLike;
            const summary = summarizeTool(tu.name ?? "tool", tu.input);
            if (tu.evaluated_permission === "ask") {
              emit({ type: "confirm", toolUseId: tu.id, name: tu.name ?? "tool", summary });
            } else {
              emit({ type: "tool", name: tu.name ?? "tool", summary });
            }
            return false;
          }
          case "session.error": {
            const e = event.error as { message?: string; type?: string } | undefined;
            emit({ type: "error", message: e?.message || e?.type || "The session reported an error." });
            return false;
          }
          case "session.status_idle": {
            const reason = (event.stop_reason as { type: string }).type;
            // requires_action = waiting on the user's yes/no; keep the stream open.
            if (reason === "requires_action") {
              emit({ type: "status", status: "idle" });
              return false;
            }
            emit({ type: "done", reason });
            return true;
          }
          case "session.status_terminated":
            emit({ type: "done", reason: "terminated" });
            return true;
          default:
            return false;
        }
      };

      try {
        if (text) {
          await anthropic.beta.sessions.events.send(sessionId, {
            events: [{ type: "user.message", content: [{ type: "text", text }] }],
          });
        } else {
          // Resume: the SSE stream has no replay, so consolidate with the history.
          // Replay only the current turn (everything after the last user.message),
          // so pending yes/no questions and missed replies are delivered again.
          const history: Array<{ id?: string; type: string; [k: string]: unknown }> = [];
          for await (const ev of anthropic.beta.sessions.events.list(sessionId)) {
            history.push(ev as unknown as { id?: string; type: string });
          }
          let lastUser = -1;
          history.forEach((ev, i) => {
            if (ev.type === "user.message") lastUser = i;
          });
          const turn = history.slice(lastUser + 1);
          const confirmed = new Set(
            turn
              .filter((ev) => ev.type === "user.tool_confirmation")
              .map((ev) => String((ev as { tool_use_id?: string }).tool_use_id)),
          );
          for (const ev of turn) {
            const isAnsweredAsk =
              (ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") &&
              confirmed.has(String(ev.id));
            if (isAnsweredAsk) {
              if (ev.id) seen.add(ev.id);
              continue;
            }
            if (handle(ev)) return finish();
          }
          const session = await anthropic.beta.sessions.retrieve(sessionId);
          if (session.status !== "running" && session.status !== "rescheduling") {
            const lastIdle = [...turn].reverse().find((ev) => ev.type === "session.status_idle") as
              | { stop_reason?: { type: string } }
              | undefined;
            if (lastIdle?.stop_reason?.type !== "requires_action") {
              emit({ type: "done", reason: lastIdle?.stop_reason?.type ?? session.status });
              return finish();
            }
          }
        }

        for await (const event of stream) {
          if (handle(event as unknown as { id?: string; type: string })) break;
        }
      } catch (err) {
        if (!closed) emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        stream.controller.abort();
        finish();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
