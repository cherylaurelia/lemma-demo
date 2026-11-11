# Failed `streamText` runs and `vercelAI()`

Unofficial demo by Cheryl Aurelia: not affiliated with Lemma.

On the [documented streaming setup](https://docs.uselemma.ai/integrations/vercel-ai), `@uselemma/tracing` 7.12.5 sends no trace when the provider returns an HTTP error before the first step, and sends `error: null` when the failure comes mid-answer or after a tool step. `streamText` reports those failures in the stream rather than throwing, and `vercelAI()` doesn't implement the AI SDK's `onError`, `onStepError` or `onAbort` hooks.

The other three TypeScript integrations record the same 429 as an error.

## What's here

- `app/`: the page, which renders `data/before.json` and `data/after.json`, the recorded output of the repro.
- `repro/`: runs the docs pattern through the real `@ai-sdk/openai` provider against a local server. No account or key.
- [The patch](https://github.com/uselemma/lemma/compare/main...cherylaurelia:lemma:fix/vercel-stream-errors), on a fork branch.

```bash
cd repro && npm install
npm run before   # published 7.12.5
npm run after    # patched build, repro/uselemma-tracing-7.12.6.tgz
```

## Not tested

Lemma's backend and dashboard, and calls to a real model API (the real provider SDK talks to a local server). The patch only affects AI SDK v7: on v6, successful runs are unchanged and a failed stream still sends no trace, because v6 telemetry has no error hook.

## Run the page

```bash
npm install && npm run build && npm run start
```
