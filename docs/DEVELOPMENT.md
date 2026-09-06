# Development and validation

[English](DEVELOPMENT.md) · [简体中文](DEVELOPMENT.zh-CN.md)

## Build and test

Use Node.js 22 or newer (verified with Node.js 24).

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run check` runs type checking, all tests, and the build. The version comes from `package.json`; release content comes from `src/` and `addon/`. Local settings, caches, preview code, and integration test entry points are excluded from the XPI.

## Source layout

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle, native sidebar registration, reader events |
| `src/ui.ts` | Chat, settings, conversation history, note review |
| `src/i18n.ts`, `src/locales/` | Language preference, parameterized Chinese/English messages, live text bindings |
| `src/agent.ts` | Six scoped tools, context assembly, agent loop |
| `src/provider.ts` | Chat Completions, model discovery, SSE, cancellation, errors |
| `src/models.ts` | Multi-model settings and legacy migration |
| `src/selection.ts` | Text selection, copying, streaming selection protection |
| `src/zotero.ts` | Reader adapter, credentials, preferences, local sessions |
| `src/markdown.ts` | Markdown, formulas, source references |
| `addon/` | Manifest, bootstrap, styles, icons, Fluent resources |

PDF text, page labels, and selections use Zotero reader internals, isolated in the adapter. Revalidate on a new Zotero major version; changing a compatibility number alone is insufficient.

### Localization

The preference `extensions.margin.language` is separate from model configuration. `auto` uses Zotero's locale, with Chinese mapped to `zh-CN` and all other languages mapped to `en-US`. Explicit overrides are persisted without changing Zotero's locale.

Chinese message IDs are shared by both catalogs, with named parameters such as `{page}` and `{count}`. The English catalog is typed against the Chinese keys; tests check key and parameter parity. Add new UI messages to both catalogs. Use `t()` for plain text and `L()` for escaped, live-bound text in UI markup. Dynamic status messages are translated only in plugin-owned status containers. Never run translation over document text or model output.

Language listeners refresh interface text without replacing conversation nodes or unsaved settings. Native Fluent labels use the same wording; the navigation tooltip also follows a manual override. Catalogs are bundled into `plugin.js`, and both Fluent locales are included in the universal XPI.

## Browser preview

Run these in separate terminals:

```sh
node scripts/mock-provider.mjs
```

```sh
npm run preview
```

Open `http://127.0.0.1:18766`. The preview uses the production sidebar with a fixture document. The mock API listens on `127.0.0.1:18765` and tests protocol/tool flows, not model intelligence. A browser preview does not replace native layout or clipboard validation.

## Isolated native tests

Build the XPI and prepare an independent profile:

```sh
npm run build
node scripts/prepare-runtime.mjs run-1
```

The script creates `.runtime/run-1/` with a separate profile, library, fixture PDF, and test XPI. Keep the mock API running, then launch your installed Zotero with that profile. For example, in PowerShell:

```powershell
& 'C:\Program Files\Zotero\zotero.exe' -no-remote -profile "$PWD\.runtime\run-1\profile" -purgecaches
```

Adjust the executable path for your installation. **Never run the integration harness in your everyday Zotero profile.**

Results are written to `.runtime/run-1/result.json`. `scripts/runtime-integration.js` is injected only into the test XPI and is not shipped. The convenience script `scripts/run-runtime.ps1` assumes `D:\Zotero\zotero.exe`; check the path before using it. It restarts only the matching isolated profile.

The native harness exercises production UI in Zotero, measures element bounds, compares selected text with the system clipboard, and captures fixture-only panels through Gecko's renderer. History stress cases cover two locales, multiple widths, long titles, long unbroken words, and enlarged text. See [VALIDATION.md](../VALIDATION.md) for the exact automated and native coverage, including any manual checks not repeated.

## Release

1. Synchronize versions in `package.json`, the lockfile, and `addon/manifest.json`.
2. Run `npm run check` and the relevant native acceptance tests.
3. Inspect XPI entries: include both languages; exclude runtime fixtures, test entry points, credentials, and source maps.
4. Compute SHA-256 **after the final build**. Attach the XPI and checksum file to the matching GitHub Release.
5. Update both READMEs, changelog, and validation record with the release version and actual verification scope.

Installation and updates remain manual. The manifest's reserved `.invalid` update URL is a placeholder; it does not retrieve updates from a third party. A working automatic update feed would require a separate implementation and verification.
