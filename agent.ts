// agent.ts — Vercel AI SDK + Composio tool router
//
// Run:  npm run agent -- "Star the composiohq/composio repo on GitHub"
// Env:  COMPOSIO_API_KEY and ANTHROPIC_API_KEY (see .env.template)

import "dotenv/config";
import { anthropic } from "@ai-sdk/anthropic";
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { stepCountIs, streamText } from "ai";

for (const key of ["COMPOSIO_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} — add it to .env (see .env.template).`);
    process.exit(1);
  }
}

const composio = new Composio({ provider: new VercelProvider() });

// Tripplet user ids double as Composio user ids elsewhere in the app;
// for this standalone script the user is configurable via env.
const userId = process.env.COMPOSIO_USER_ID ?? "user_mq21yb";

// Create a tool router session
const session = await composio.create(userId);
const tools = await session.tools();

const prompt =
  process.argv.slice(2).join(" ") ||
  "Star the composiohq/composio repo on GitHub";

const stream = await streamText({
  model: anthropic("claude-sonnet-4-6"),
  prompt,
  stopWhen: stepCountIs(10),
  tools,
});

for await (const textPart of stream.textStream) {
  process.stdout.write(textPart);
}
process.stdout.write("\n");
