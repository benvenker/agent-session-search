import { GeminiAgent as SmithersGeminiAgent } from "smithers-orchestrator";

// GeminiAgent is the legacy Gemini CLI integration. Smithers does not currently
// expose a thinking-level option here; Gemini 3.1 Pro defaults to high thinking.
export const Gemini31ProAgent = new SmithersGeminiAgent({
  model: "gemini-3.1-pro",
  cwd: process.cwd(),
  outputFormat: "stream-json",
});
