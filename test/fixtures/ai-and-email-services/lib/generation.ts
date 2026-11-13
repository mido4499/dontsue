import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function generateResume(diary: string) {
  return anthropic.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: diary }],
  });
}
