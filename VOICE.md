# Voice Claude

Talk to Claude through your headphones. Claude does the work in a **remote cloud session**
(a Claude Managed Agents container with bash, files and code), then reads the result back to you.

```
 🎧 you speak ──► browser speech-to-text ──► /api/voice/command ──► Managed Agents session (cloud container)
 🎧 you hear  ◄── browser text-to-speech ◄── streamed agent replies ◄──┘
```

## Setup (once)

1. `pnpm install`
2. `cp .env.example .env.local` and set `ANTHROPIC_API_KEY` and `VOICE_APP_PASSCODE`.
3. `pnpm setup:voice` — creates the agent + environment and prints `VOICE_AGENT_ID` / `VOICE_ENVIRONMENT_ID`.
   Paste them into `.env.local`. Run this only once (add `-- --web` to enable web search/fetch).
4. `pnpm dev` and open http://localhost:3000/voice in Chrome, Edge or Safari.
5. Open **Settings**, enter the passcode, allow microphone access.

To use it from your phone, deploy the app (e.g. Vercel) and set the same variables there.
Speech recognition needs HTTPS (or localhost).

## Using it

- Tap the mic (or press **Space**) and speak. Release/pause and Claude starts working.
- Claude's replies are spoken; the final reply is a short spoken summary.
- If Claude wants to do something risky it asks: *"Claude wants to run the command … Say yes or no."*
- Voice shortcuts: **"stop"** interrupts Claude · **"repeat"** · **"new session"**.
- Settings: voice and speed, **hands-free** (auto-listen after each reply), narrate each step,
  and **headphone button = talk** (uses the play/pause button on your headphones; best effort).

A session keeps its files and context between commands until you say "new session".

## Notes

- Cost: Managed Agents bills tokens plus session runtime. It is a beta API and keeps
  session history until deleted.
- Long tasks: the command request is held open up to `maxDuration` (300 s). If it's cut,
  the page re-attaches to the same session automatically.
- Set `VOICE_GITHUB_REPO_URL` + `GITHUB_TOKEN` to have your repo mounted at `/workspace/repo`.
