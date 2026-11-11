import after from "@/data/after.json";
import before from "@/data/before.json";

const DIFF_URL = "https://github.com/uselemma/lemma/compare/main...cherylaurelia:lemma:fix/vercel-stream-errors";
const REPO_URL = "https://github.com/cherylaurelia/lemma-demo";
const REPRO_URL = "https://github.com/cherylaurelia/lemma-demo/tree/main/repro";
const DOCS_URL = "https://docs.uselemma.ai/integrations/vercel-ai";

const SNIPPET = `const result = streamText({
  model,
  prompt: userMessage,
  telemetry: { functionId: "support-agent", integrations: [lemmaTelemetry] },
});

for await (const _part of result.fullStream) {
  // stream to your response
}

await lemmaTelemetry.flush();`;

const CONTROLS = [
  { name: "OpenAI Agents", sent: "1 trace", error: "Error in agent run" },
  { name: "LangChain", sent: "1 trace", error: "RateLimitCapacityError: 429 Rate limit reached" },
  { name: "Mastra", sent: "1 trace", error: "Rate limit reached" },
  { name: "Vercel AI", sent: "0 traces", error: "nothing sent" },
];

type Result = (typeof before)[number];

function describe(result: Result) {
  if (result.tracesSent === 0) return "no trace sent";

  if (result.rootError) return `error: ${result.rootError}`;

  return `error: null, output: ${JSON.stringify(result.rootOutput)}`;
}

function isRecorded(result: Result) {
  return result.case === "success" ? result.rootError === null : Boolean(result.rootError);
}

function Outcome({ result }: { result: Result }) {
  return (
    <span className={`font-mono text-xs break-words ${isRecorded(result) ? "text-good" : "text-bad"}`}>
      {describe(result)}
    </span>
  );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border border-purple bg-white p-5 sm:p-6">
      <p className="font-mono text-xs tracking-wider text-purple-deep">{label}</p>
      {children}
    </section>
  );
}

export default function Page() {
  const rows = before.map((result, index) => ({ result, patched: after[index] }));

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <p className="font-mono text-xs tracking-wider text-muted">@uselemma/tracing 7.12.5 · ai 7.0.169</p>
      <h1 className="mt-3 text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
        A failed <code className="font-mono text-3xl sm:text-4xl">streamText</code> run doesn&apos;t reach Lemma as a
        failure.
      </h1>
      <p className="mt-5 text-lg">
        <strong>Problem:</strong> <code className="font-mono">streamText</code> reports provider errors in the stream
        instead of throwing, and <code className="font-mono">vercelAI()</code> doesn&apos;t listen for them.
      </p>
      <p className="mt-2 text-lg">
        <strong>Fix:</strong> implement the AI SDK&apos;s <code className="font-mono">onError</code>,{" "}
        <code className="font-mono">onStepError</code> and <code className="font-mono">onAbort</code> hooks, in one file.
      </p>
      <p className="mt-2 text-lg">
        <strong>What it costs:</strong> a burst of 429s during streamed chats wouldn&apos;t show up as failed runs.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a className="bg-navy px-4 py-2 font-medium text-paper" href={DIFF_URL}>
          See the patch
        </a>
        <a className="border border-line bg-white px-4 py-2 font-medium" href={REPRO_URL}>
          Run the repro
        </a>
        <a className="border border-line bg-white px-4 py-2 font-medium" href={REPO_URL}>
          This page&apos;s repo
        </a>
      </div>
      <p className="mt-3 text-sm text-muted">
        The patch covers AI SDK v7. On v6, successful runs are unchanged and a failed stream still sends no trace, since
        v6 telemetry has no error hook.
      </p>

      <Frame label="1 · WHAT THE SDK SENDS">
        <p className="mt-3">
          Each row is the real <code className="font-mono">@ai-sdk/openai</code> provider talking to a local server that
          returns that failure. The right two columns are the body the SDK posted to{" "}
          <code className="font-mono">/traces/ingest</code>.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-2 pr-4 font-medium">Model API does</th>
                <th className="py-2 pr-4 font-medium">SDK sends today</th>
                <th className="py-2 font-medium">With the patch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.result.case} className="border-t border-line align-top">
                  <td className="py-2 pr-4 font-medium">{row.result.case}</td>
                  <td className="py-2 pr-4">
                    <Outcome result={row.result} />
                  </td>
                  <td className="py-2">
                    <Outcome result={row.patched} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted">
          Whether a trace is sent, and with what error, is decided in the SDK, so none of this needs the backend to
          confirm. I couldn&apos;t run Lemma&apos;s backend or dashboard. A dropped connection already works, because that case throws and reaches{" "}
          <code className="font-mono">fail()</code>. For an error event mid-answer, v7&apos;s telemetry doesn&apos;t
          expose the provider&apos;s message, so the patch records a generic one. Aborts are labelled{" "}
          <code className="font-mono">AI SDK run aborted</code> with the reason, so a user&apos;s Stop can be filtered
          out of real failures.
        </p>
      </Frame>

      <Frame label="2 · SAME 429, SAME HARNESS, EACH TS INTEGRATION">
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-muted">
                <th className="py-2 pr-4 font-medium">Integration (streaming)</th>
                <th className="py-2 pr-4 font-medium">Sent</th>
                <th className="py-2 font-medium">Root error</th>
              </tr>
            </thead>
            <tbody>
              {CONTROLS.map((control) => (
                <tr key={control.name} className="border-t border-line align-top">
                  <td className="py-2 pr-4 font-medium">{control.name}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{control.sent}</td>
                  <td className="py-2 font-mono text-xs break-words">{control.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Frame>

      <Frame label="3 · THE SETUP, FROM THE DOCS">
        <p className="mt-3">
          This is the{" "}
          <a className="underline" href={DOCS_URL}>
            Streaming section
          </a>
          . The docs say to call <code className="font-mono">fail(error)</code> if the call throws, and on these
          failures it doesn&apos;t.
        </p>
        <pre className="mt-4 overflow-x-auto bg-navy p-4 font-mono text-xs leading-relaxed text-paper">{SNIPPET}</pre>
      </Frame>

      <Frame label="4 · ALSO IN THE PATCH">
        <p className="mt-3">
          On AI SDK v7 the payload carries two generations per model call, with the same usage on each: one call at 11
          in and 7 out arrives as 22 and 14. <code className="font-mono">ai</code> fires{" "}
          <code className="font-mono">onStepEnd</code> and its deprecated alias{" "}
          <code className="font-mono">onStepFinish</code>, and the alias goes to the v6 recorder. It&apos;s a
          separate commit. This is what the SDK sends; it would only inflate token and cost analytics if ingest
          doesn&apos;t de-duplicate. Does it?
        </p>
      </Frame>

      <Frame label="5 · HOW IT WAS CHECKED">
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Failure cases reproduced on ai 7.0.0, 7.0.92 and 7.0.169, before and after the patch.</li>
          <li>
            Five regression tests through real <code className="font-mono">streamText</code> fail on main; the full
            package suite of 269 passes with the patch.
          </li>
          <li>Successful runs, generateText, handled tool errors and sequential reuse behave as before.</li>
          <li>The real provider SDK talked to a local server: no calls to OpenAI, and no Lemma account.</li>
        </ul>
        <pre className="mt-4 overflow-x-auto bg-navy p-4 font-mono text-xs leading-relaxed text-paper">
          {"cd repro && npm install\nnpm run before\nnpm run after"}
        </pre>
      </Frame>

      <footer className="mt-12 border-t border-line pt-5 text-sm text-muted">
        Unofficial demo by Cheryl Aurelia: not affiliated with Lemma.
      </footer>
    </main>
  );
}
