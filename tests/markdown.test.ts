import { setLanguage } from "../src/i18n";
import test from "node:test";
test.beforeEach(() => setLanguage("zh-CN"));
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderMarkdown, renderNote } from "../src/markdown";
const sources = [{ id: "p2", pageIndex: 1, pageLabel: "21", excerpt: "source" }];
test("model HTML and images cannot execute scripts or load remote content", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> ![remote](https://evil.example/pixel) [bad](javascript:alert(1))');
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll("img,script,iframe,[onerror]").length, 0);
  assert.ok(!doc.querySelector('a[href^="javascript:"]'));
});
test("only verified source IDs become navigation buttons", () => {
  const doc = new JSDOM(renderMarkdown("原文 [[p2]]，编造 [[p99]]。", sources)).window.document;
  assert.equal(doc.querySelectorAll("button[data-source]").length, 1);
  assert.equal(doc.querySelector("button")?.textContent, "21 ↗");
  assert.ok(doc.body.textContent?.includes("出处未验证"));
});
test("notes preserve physical PDF links for personal and group libraries", () => {
  assert.ok(renderNote("text [[p2]]", sources, "ABCD1234").includes("zotero://open-pdf/library/items/ABCD1234?page=2"));
  assert.ok(renderNote("text [[p2]]", sources, "ABCD1234", 123).includes("groups/123/items/ABCD1234?page=2"));
});
test("inline and block formula rendering does not enable trusted KaTeX commands", () => {
  const html = renderMarkdown("$x^2$ and $y_1$\n\n$$\\sum_{i=1}^n i$$");
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll(".katex").length, 3);
  assert.ok(!renderMarkdown("$\\href{javascript:alert(1)}{x}$").includes('href="javascript:'));
});
