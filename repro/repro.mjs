// Runs the docs' streamText + vercelAI() pattern through the real @ai-sdk/openai
// provider. One local server plays the model API and records what Lemma would
// receive at POST /traces/ingest. No account or API key needed.
import http from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { vercelAI } from "@uselemma/tracing";
import { z } from "zod";

const usage = {
  input_tokens: 11,
  output_tokens: 7,
  total_tokens: 18,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
};

const base = { object: "response", created_at: 1, model: "gpt-4o-mini" };
const event = (body) => `event: ${body.type}\ndata: ${JSON.stringify(body)}\n\n`;

function textEvents(id, text) {
  const item = { type: "message", id, role: "assistant", status: "in_progress", content: [] };

  return [
    event({ type: "response.created", sequence_number: 0, response: { ...base, id: `r${id}`, status: "in_progress", output: [] } }),
    event({ type: "response.output_item.added", sequence_number: 1, output_index: 0, item }),
    event({ type: "response.content_part.added", sequence_number: 2, item_id: id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }),
    event({ type: "response.output_text.delta", sequence_number: 3, item_id: id, output_index: 0, content_index: 0, delta: text, logprobs: [] }),
  ];
}

function finishText(id, text) {
  const part = { type: "output_text", text, annotations: [] };
  const item = { type: "message", id, role: "assistant", status: "completed", content: [part] };

  return [
    event({ type: "response.output_text.done", sequence_number: 4, item_id: id, output_index: 0, content_index: 0, text, logprobs: [] }),
    event({ type: "response.content_part.done", sequence_number: 5, item_id: id, output_index: 0, content_index: 0, part }),
    event({ type: "response.output_item.done", sequence_number: 6, output_index: 0, item }),
    event({ type: "response.completed", sequence_number: 7, response: { ...base, id: `r${id}`, status: "completed", output: [item], usage } }),
  ];
}

function toolEvents() {
  const item = { type: "function_call", id: "f1", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}', status: "completed" };

  return [
    event({ type: "response.created", sequence_number: 0, response: { ...base, id: "r1", status: "in_progress", output: [] } }),
    event({ type: "response.output_item.added", sequence_number: 1, output_index: 0, item: { ...item, arguments: "", status: "in_progress" } }),
    event({ type: "response.function_call_arguments.done", sequence_number: 2, item_id: "f1", output_index: 0, arguments: item.arguments }),
    event({ type: "response.output_item.done", sequence_number: 3, output_index: 0, item }),
    event({ type: "response.completed", sequence_number: 4, response: { ...base, id: "r1", status: "completed", output: [item], usage } }),
  ];
}

const httpError = (res, status, message) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message, type: "error", code: String(status) } }));
};

const sse = (res) => res.writeHead(200, { "content-type": "text/event-stream" });

const cases = {
  success: (res) => { sse(res); res.end([...textEvents("m1", "the full answer"), ...finishText("m1", "the full answer")].join("")); },
  "HTTP 429": (res) => httpError(res, 429, "Rate limit reached"),
  "HTTP 500": (res) => httpError(res, 500, "The server had an error"),
  "connection dropped mid-answer": (res) => { sse(res); res.write(textEvents("m1", "the answer was go").join("")); setTimeout(() => res.destroy(), 30); },
  "error event mid-answer": (res) => { sse(res); res.end([...textEvents("m1", "the answer was go"), event({ type: "error", sequence_number: 4, code: "server_error", message: "The model failed", param: null })].join("")); },
  "client aborts mid-answer": (res) => { sse(res); res.write(textEvents("m1", "the answer was go").join("")); },
  "HTTP 500 after a tool ran": (res, call) => { if (call > 1) return httpError(res, 500, "The server had an error"); sse(res); res.end(toolEvents().join("")); },
};

let current;
let modelCalls = 0;
let received = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (req.url.includes("/traces/ingest")) {
      received.push(JSON.parse(body).trace);
      res.writeHead(201, { "content-type": "application/json" });
      res.end("{}");

      return;
    }

    modelCalls += 1;
    cases[current](res, modelCalls);
  });
});

await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });

const url = `http://127.0.0.1:${server.address().port}`;
const openai = createOpenAI({ apiKey: "local", baseURL: `${url}/v1` });

const results = [];

for (const name of Object.keys(cases)) {
  current = name;
  modelCalls = 0;
  received = [];
  const lemmaTelemetry = vercelAI({ apiKey: "local", projectId: "00000000-0000-0000-0000-000000000000", baseUrl: url });
  let sawError = false;
  const controller = new AbortController();

  if (name.includes("aborts")) setTimeout(() => controller.abort(new Error("user pressed stop")), 100);

  const result = streamText({
    model: openai("gpt-4o-mini"),
    prompt: "hello",
    maxRetries: 0,
    abortSignal: controller.signal,
    stopWhen: stepCountIs(4),
    onError: () => {},
    tools: { lookup: tool({ description: "look something up", inputSchema: z.object({ q: z.string() }), execute: async () => "ok" }) },
    telemetry: { functionId: "support-agent", integrations: [lemmaTelemetry] },
  });

  try {
    for await (const part of result.fullStream) {
      if (part.type === "error") sawError = true;
    }

    await lemmaTelemetry.flush();
  } catch (error) {
    await lemmaTelemetry.fail(error);
  }

  await new Promise((resolve) => { setTimeout(resolve, 500); });
  const trace = received[0];
  const spans = trace?.spans ?? [];
  results.push({
    case: name,
    appSawError: sawError,
    modelCalls,
    tracesSent: received.length,
    rootError: trace?.error ?? null,
    rootOutput: trace?.output ?? null,
    generations: spans.filter((span) => span.type === "generation").length,
    tools: spans.filter((span) => span.type === "tool").length,
  });
}

server.close();

console.log(JSON.stringify(results, null, 2));

process.exit(0);
