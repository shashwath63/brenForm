// One-time setup for the voice app: creates the Managed Agents environment
// (the remote cloud container config) and the agent, then prints the IDs to
// put in .env.local. Run it ONCE — every voice session reuses these IDs.
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/setup-voice-agent.mjs
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/setup-voice-agent.mjs --web   # also enable web search/fetch
//
// To change the agent later, update it (client.beta.agents.update) instead of
// running this again — re-running creates a second, separate agent.
import Anthropic from "@anthropic-ai/sdk";

const enableWeb = process.argv.includes("--web");
const client = new Anthropic();

const SYSTEM_PROMPT = `You are a voice-driven assistant. The user speaks commands through headphones and hears your replies read aloud by a text-to-speech engine; they usually cannot see a screen.

How to work:
- Do the task fully using your tools (bash, files, code) in your workspace. If a git repository is mounted under /workspace, that is the project the user means.
- Before a long task, send one short sentence saying what you are about to do.
- Your final message for each request is read aloud. Make it a spoken summary: 1 to 5 plain sentences, no markdown, no tables, no code blocks, no URLs or long file paths unless the user asked for them. Say numbers and results in words a listener can follow.
- If you need a decision from the user, ask one clear yes/no or short-answer question and stop.`;

const environment = await client.beta.environments.create({
  name: "voice-claude-env",
  config: {
    type: "cloud",
    networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: true },
  },
});

const agent = await client.beta.agents.create({
  name: "Voice Claude",
  model: "claude-opus-5-5",
  system: SYSTEM_PROMPT,
  tools: [
    {
      type: "agent_toolset_20260401",
      // auto: the server approves safe calls itself and pauses the rest for you;
      // the voice app reads paused calls aloud and asks "yes or no".
      default_config: { enabled: true, permission_policy: { type: "auto" } },
      configs: [
        { name: "web_fetch", enabled: enableWeb },
        { name: "web_search", enabled: enableWeb },
      ],
    },
  ],
});

console.log("\nDone. Add these lines to .env.local:\n");
console.log(`VOICE_AGENT_ID=${agent.id}`);
console.log(`VOICE_ENVIRONMENT_ID=${environment.id}`);
if (enableWeb) {
  console.log(
    "\nNote: web tools are on, but with 'limited' networking they only reach hosts you list in the environment's allowed_hosts.",
  );
}
