# Margin 0.3.1 validation

Date: 2026-09-06. Platform: Windows / Zotero **10.0.1**, Node.js 24.19.0.

Release: `margin-0.3.1.xpi`, **1,111,319 bytes**, 77 entries.

SHA-256: `0d731d2f680e3a7dfa6bd27b22c33a0f5cb14ecb3bd577f1b70a63ddad66490b`

## Problem and correction

The previous parser stopped after receiving 2,000,000 bytes of SSE traffic. Repeated JSON envelopes and ignored provider fields counted toward that limit, so an ordinary answer could be cut off even when its visible text was much smaller. This was a plugin transfer limit, separate from a provider's `finish_reason: length`.

Version 0.3.1 separates retained text, tool data, event buffering, and transfer limits. It also distinguishes idle timeout from total request timeout, preserves partial JSON responses on model truncation, and offers an explicit continuation action.

## Automated verification

`npm run check` passed: type checking, **46 tests**, and build.

| Requirement | Evidence |
| --- | --- |
| Large valid streams | A generated stream above the old 2 MB threshold, with Chinese, emoji, and ignored reasoning fields, returns identical content when transported in 37-byte chunks, 8 KiB chunks, or one large chunk. A single content event produces the same final answer. |
| Text versus framing limits | A small injected text budget retains the exact allowed prefix regardless of chunk boundaries. Many complete events in a large network chunk do not trigger the per-event limit. |
| Bounded exceptional data | Tests reject oversized unfinished events, JSON bodies, accumulated tool fields, and total transfer with distinct error codes. Production limits: 100,000 UTF-16 units of text, 262,144 units across tool fields, 1,048,576 units per event/JSON response, 64 MiB transferred per completion. |
| Partial output | JSON and SSE responses ending with model length limits retain their partial text. Premature EOF is reported as a connection interruption rather than success. |
| Timeouts and cancellation | Injected deadlines verify that activity refreshes the idle timer, a stalled body is cancelled, continued traffic still reaches the total deadline, and user cancellation remains distinct. Production values are 60 seconds idle / 10 minutes total per model request; tests use shorter intervals. |
| Continuation context | Original question, complete partial text within the context budget, and source IDs reach the next request. Repeated continuation bounds oversized prior text with a marked omission, as documented in the development guide. |
| No repeated write actions | Only read-only schemas are offered during continuation. A model that nevertheless returns `navigate` or `create_note` receives execution errors; those actions do not run. |
| UI and persistence | Continuation retains the original answer ID/node, selected text, unsent draft, source references, and original model. A separately selected chat model stays selected for the next new question. Removed original models are rejected explicitly. Legacy partial messages remain usable. |
| Regression | The existing language, history, model discovery/routing, scoped reader tools, Markdown safety, cancellation, and copy tests pass. |

## Native Zotero verification

Full results: [native-0.3.1.json](validation/native-0.3.1.json). Tests ran inside the production sidebar with an isolated profile, fixture PDF, and local mock service. No personal papers or daily-use profile were used.

- **Long response:** the local HTTP service sent **3,540,057 bytes** of SSE data. Zotero displayed the exact **10,000-character** expected answer, with no truncation error. The DOM comparison removes only Markdown's enclosing-paragraph whitespace.
- **Interruption:** a model length response preserved text and its verified citation, displayed the specific model-limit message, and exposed **Continue generating**.
- **Continuation:** the button appended to the same answer, retained the unsent draft and clickable source, and removed the incomplete state after success.
- **Side effects:** the mock model deliberately returned unoffered note-save and navigation calls. The agent rejected them; native note count and PDF page position were unchanged.
- **Regression:** native full-height layout, narrow widths, history bounds, language switching, streaming selection, clipboard comparisons, tool flow, model routing, document switching, and plugin cleanup/reload passed again.

Native Gecko-rendered fixture screenshots were inspected:

- [Interrupted answer](validation/interrupted-0.3.1.png)
- [Continued answer](validation/continued-0.3.1.png)

These are native rendering and DOM/system-clipboard checks, not a browser substitute. Physical mouse/keyboard input was not repeated in this patch run. Prior language/process-restart and physical-copy coverage is documented in the [0.3.0](validation/0.3.0.md) and [0.2.0](validation/0.2.0.md) records. Native macOS/Linux validation remains pending.

## Model testing scope

All model requests used local synthetic services: `margin-test-model`, `margin-test-alternate`, `margin-test-long`, and `margin-test-resume`. **No real LLM service was called.** The tests prove protocol handling, UI recovery, and tool execution boundaries; they do not establish the quality of a real model's continuation. A real model may repeat or rephrase text despite the continuation instruction.

Continuation is an explicit new request using the answer's original enabled model. It does not automatically retry or replay tool calls. For older messages without a stored reader snapshot, current reader metadata and retained sources are used.

## Release checks

[Package inventory](validation/package-0.3.1.json) confirms the 0.3.1 manifest, both Fluent languages, bundled bilingual continuation/error strings, and absence of runtime, preview, integration code, sessions, credentials, fixture models, and source maps. SHA-256 was generated after the final build. Published assets are downloaded and checked against this hash.

One universal XPI is provided. Installation and updates remain manual. Supported scope remains Zotero 10.0.x and PDFs with a text layer.
