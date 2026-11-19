import Anthropic from "@anthropic-ai/sdk";

// Resolves ANTHROPIC_API_KEY (or another configured credential) from the server environment.
export const anthropic = new Anthropic();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in the server environment (.env.local)`);
  return value;
}

/**
 * Every voice route can start paid agent work, so it is locked behind a passcode.
 * Returns an error Response when the request is not allowed, or null when it is.
 */
export function checkPasscode(req: Request): Response | null {
  const expected = process.env.VOICE_APP_PASSCODE;
  if (!expected) {
    return Response.json(
      { error: "Set VOICE_APP_PASSCODE in .env.local before using the voice app." },
      { status: 500 },
    );
  }
  if (req.headers.get("x-voice-passcode") !== expected) {
    return Response.json({ error: "Wrong passcode." }, { status: 401 });
  }
  return null;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof Anthropic.APIError) {
    return Response.json({ error: `Claude API error ${err.status}: ${err.message}` }, { status: 502 });
  }
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}
