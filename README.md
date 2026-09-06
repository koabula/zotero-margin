# Margin

[English](README.md) · [简体中文](README.zh-CN.md)

**Read, ask, and return to the source — inside Zotero.**

Margin is an AI reading companion in Zotero's right sidebar. It reads the current PDF, explains selected passages, finds supporting text, and helps turn your reading into notes. You choose the model and supply your own API connection.

[Download](https://github.com/koabula/zotero-margin/releases/latest) · [Changelog](CHANGELOG.md) · [Validation](VALIDATION.md) · [Report an issue](https://github.com/koabula/zotero-margin/issues)

> **Version 0.3.0** targets **Zotero 10.0.x** and PDFs with a text layer. Native integration is tested on Windows with Zotero 10.0.1. Native testing on macOS and Linux is still pending.

## Features

- **Read together:** explain a selection, clarify concepts, summarize a page, and ask follow-up questions.
- **Check the paper:** read pages on demand, search the current document, and consult your highlights and annotations.
- **Follow the evidence:** click source references to navigate to the relevant page. Printed page labels and PDF page numbers remain distinct.
- **Save reading notes:** review a proposed note before saving it under the current item, or save a complete answer.
- **Choose your models:** connect a Chat Completions API with tool calling, discover or manually add models, and switch models per conversation.
- **Stay focused:** a full-height Mono Light sidebar, independently scrolling conversations, and selectable text in answers, code, and note previews.
- **Use English or Chinese:** one XPI includes both languages, with automatic detection and an in-plugin language selector.

The assistant's tools are limited to reading-related actions in Zotero. It has no shell, arbitrary file access, or web browsing tool.

## Install

1. Download **`margin-0.3.0.xpi`** from [Releases](https://github.com/koabula/zotero-margin/releases/latest). Choose the XPI, not GitHub's generated source archive.
2. In Zotero, open **Tools → Plugins**.
3. Open the gear menu, choose **Install Add-on From File**, and select the XPI.
4. Open a PDF and click the **Margin** icon in the right navigation rail.

Install a newer XPI the same way to upgrade. Existing API settings, credentials, drafts, and conversation history are preserved. Legacy single-model settings migrate to one enabled model and a default model.

Updates are **manual**. There is no automatic update service.

## Language

Open settings and use **Language / 语言** at the top:

- **Follow Zotero:** Simplified Chinese for Chinese Zotero locales; English for all other locales.
- **简体中文** or **English:** override the language for Margin only.

The choice is saved immediately, even without API settings, and applies to open Margin panels. It does not change Zotero's language. Drafts, selected models, history, and ongoing generation are preserved; existing answers and notes are not translated. Quick prompts follow the interface language. The model is instructed to answer in the language of your question, unless you explicitly request another language.

## Connect a model

Open settings using the icon at the top right.

| Setting | What to enter |
| --- | --- |
| Base URL | Your provider's compatible API address, such as `https://api.example.com/v1`. A full `/chat/completions` URL is also accepted. |
| API Key | The service's access key. Leave it empty for a local service that does not require authentication. |
| Enabled models | Use **Fetch models** and select the models you want, or add model IDs manually. |
| Default model | An enabled model to use for new conversations. |

Use **Test connection** to check the default model's connection and tool calling, then **Save settings**.

Remote APIs require HTTPS. Local services can use `http://localhost:PORT/v1` or `http://127.0.0.1:PORT/v1`.

### If model discovery fails

**Fetch models** requests the sibling `GET /models` endpoint, preserving your configured path prefix:

```text
https://api.example.com/custom/v1/chat/completions
→ https://api.example.com/custom/v1/models
```

Margin does not guess extra path segments. Some services do not expose this endpoint; enter their model IDs manually instead. Discovery can be cancelled and times out after 15 seconds. A failed request or refreshed list does not clear enabled models.

Discovery uses the URL and key currently entered in the form. It sends no document content and does not save the form. A returned model ID does not guarantee tool-calling support; use **Test connection** to check it.

## Read with Margin

Select a passage in the PDF and choose **Ask Margin**, or enter a question in the sidebar:

- “Explain the key concepts in this passage and give a simple example.”
- “Summarize this page, separating the author's conclusions from their reasoning.”
- “Find the definition of a simulator in this paper and take me to it.”
- “Use my annotations to draft a reading note.”

Press `Enter` to send and `Shift + Enter` for a new line. Stop generation at any time. Clicking another Zotero navigation icon restores its native panel without changing panel order or pinning.

### Models and conversations

The selector below the input switches between enabled models. Each conversation remembers its model. Switching preserves context and affects the next request; switching is disabled during generation, and every tool cycle in a turn uses the model selected when you sent the question. New answers show the model actually used.

Each attachment has its own conversation and draft. **New conversation** archives the current conversation; restore it from **Conversation history**. If its model was removed, Margin falls back to the default model and shows a notice. History titles display up to two lines; hover to read the full title.

### Copy and save notes

Select text across paragraphs or code, then use `Ctrl+C` (`Cmd+C` on macOS) or right-click **Copy selected text**. Each answer also has a copy button.

While you select text in a streaming answer, its display updates pause while content continues arriving. Clear the selection to catch up without losing your place during copying.

A proposed note is only written after you choose **Save to item**. Read-only libraries cannot accept new notes.

## Data handling

- **Your API, directly:** no Margin backend or telemetry. Relevant document text, selections, conversation context, and tool results are sent to your configured service when you ask a question. That provider controls its server-side data handling.
- **Credentials:** API keys are stored in the Zotero / Gecko credential store, not ordinary preferences, conversations, or logs.
- **Local conversations:** sessions live in `margin/sessions/` under the Zotero profile directory. Extracted PDF text is cached in memory only.
- **Current document scope:** switching or closing a document stops generation. Background reading does not change the visible page; explicit navigation does.
- **Zotero notes:** saved notes follow Zotero's own synchronization settings.

Answers use Markdown with raw HTML disabled. Model-generated remote images are not loaded. Check explanations and notes against the paper.

## Support and validation

EPUB, web snapshots, OCR for scanned PDFs, image understanding, and cross-document search are not supported. Complex formulas and layouts may not extract cleanly.

Version 0.3.0 passes **37 automated tests** and native integration checks for language changes, history layout, sidebar behavior, clipboard copying, reader lifecycle, model routing, and tool flows. Model tests use a **local mock service**; they do not establish real LLM reading quality or compatibility with every provider. See the [validation record](VALIDATION.md) for methods and limits.

## Development

Use Node.js 22 or later; builds were verified with Node.js 24.

```sh
git clone https://github.com/koabula/zotero-margin.git
cd zotero-margin
npm ci
npm run check
```

This runs type checking, tests, and a build, producing `dist/margin-0.3.0.xpi`. See the [development guide](docs/DEVELOPMENT.md) for the source layout, preview, isolated native tests, and release steps.

When reporting issues, include your Zotero version, operating system, reproduction steps, and redacted error details. Do not submit API keys, personal papers, or complete private conversations.

Dependency licenses are listed in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
