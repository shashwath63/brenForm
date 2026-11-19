// Simplified events the /api/voice/command route streams to the browser (one JSON object per line).
export type VoiceEvent =
  | { type: "status"; status: "running" | "idle" | "rescheduled" }
  | { type: "message"; id: string; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "confirm"; toolUseId: string; name: string; summary: string }
  | { type: "done"; reason: string }
  | { type: "error"; message: string };
