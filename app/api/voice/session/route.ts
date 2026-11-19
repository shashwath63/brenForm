import { anthropic, checkPasscode, errorResponse, requireEnv } from "@/lib/voice/server";

// Starts a new remote session: a fresh cloud container with the agent attached.
export async function POST(req: Request) {
  const denied = checkPasscode(req);
  if (denied) return denied;

  try {
    const repoUrl = process.env.VOICE_GITHUB_REPO_URL;
    const githubToken = process.env.GITHUB_TOKEN;

    const session = await anthropic.beta.sessions.create({
      agent: requireEnv("VOICE_AGENT_ID"),
      environment_id: requireEnv("VOICE_ENVIRONMENT_ID"),
      title: `Voice session ${new Date().toISOString()}`,
      // Optional: mount a GitHub repo so voice commands can work on your code.
      resources:
        repoUrl && githubToken
          ? [
              {
                type: "github_repository",
                url: repoUrl,
                mount_path: "/workspace/repo",
                authorization_token: githubToken,
                checkout: { type: "branch", name: process.env.VOICE_GITHUB_BRANCH || "main" },
              },
            ]
          : undefined,
    });

    return Response.json({ sessionId: session.id, repo: repoUrl && githubToken ? repoUrl : null });
  } catch (err) {
    return errorResponse(err);
  }
}
