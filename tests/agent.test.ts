import test from "node:test";
import assert from "node:assert/strict";
import { ReadingAgent, tools } from "../src/agent";
import type { Complete, ReaderBridge, ReaderContext, Source } from "../src/types";

const context: ReaderContext = { attachmentID: 3, libraryID: 1, attachmentKey: "ABCD1234", title: "A paper", authors: "Author", pageIndex: 1, pageLabel: "21", pageCount: 65, selection: "simulator" };
function setup(complete: Complete = async () => ({ content: "answer", toolCalls: [] })) {
  const navigations: Source[] = []; let active = true;
  const bridge: ReaderBridge = {
    context: async () => context,
    readPage: async i => ({ pageIndex: i, pageLabel: i === 1 ? "21" : String(i + 1), text: i === 64 ? "A simulator is an ideal-world algorithm." : i === 1 ? "The view of an adversary." : "Page content" }),
    annotations: async () => [{ id: "ANN1", pageIndex: 1, pageLabel: "21", text: "highlight", comment: "comment" }],
    assertActive() { if (!active) throw new Error("文献已切换"); }, navigate: async s => { bridge.assertActive(); navigations.push(s); }, createNote: async () => ({ id: 1 }),
  };
  let content = "", saved = false;
  const agent = new ReadingAgent(bridge, context, complete, { text: s => { content += s; }, status: () => {}, sources: () => {}, note: async () => ({ saved }) });
  return { agent, navigations, bridge, deactivate: () => { active = false; }, content: () => content };
}
const signal = () => new AbortController().signal;
test("only six scoped tools; arbitrary file/code/attachment access is rejected", async () => {
  const { agent } = setup(); assert.equal(tools.length, 6);
  await assert.rejects(agent.execute("run_code", { code: "bad" }, signal()), /不允许/);
  await assert.rejects(agent.execute("read_pages", { pages: [1], attachmentID: 999 }, signal()), /未允许/);
  for (const pages of [[0], [66], [1.2], ["2"], []]) await assert.rejects(agent.execute("read_pages", { pages }, signal()));
});
test("physical page and printed label stay distinct, and references navigate correctly", async () => {
  const { agent, navigations } = setup();
  const result: any = await agent.execute("read_pages", { pages: [2] }, signal());
  assert.equal(result.pages[0].source_id, "p2"); assert.equal(result.pages[0].page_label, "21");
  await agent.execute("navigate", { source_id: "p2" }, signal()); assert.equal(navigations[0].pageIndex, 1);
  await assert.rejects(agent.execute("navigate", { source_id: "hallucinated" }, signal()));
});
test("long-document search reports coverage and continuation", async () => {
  const { agent } = setup();
  const first: any = await agent.execute("search_document", { query: "simulator" }, signal());
  assert.equal(first.results.length, 0); assert.equal(first.next_page, 61);
  const last: any = await agent.execute("search_document", { query: "SIMULATOR", start_page: first.next_page }, signal());
  assert.equal(last.results[0].pdf_page, 65); assert.equal(last.next_page, null);
});
test("document switch blocks navigation and note drafts do not claim to be saved", async () => {
  const { agent, deactivate } = setup();
  deactivate(); await assert.rejects(agent.execute("navigate", { page: 1 }, signal()), /切换/);
  const result = await agent.execute("create_note", { title: "Reading", content: "A note." }, signal());
  assert.deepEqual(result, { saved: false });
});
test("agent follows a real tool round trip and separates document data from instructions", async () => {
  let round = 0;
  const { agent, content } = setup(async (messages, _tools, onText) => {
    if (round++ === 0) {
      assert.ok(messages[0].content!.includes("不可信"));
      assert.ok(messages.at(-1)!.content!.includes('"page_label":"21"'));
      return { content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "read_pages", arguments: '{"pages":[65]}' } }] };
    }
    assert.equal(messages.at(-1)?.role, "tool");
    assert.ok(messages.at(-1)?.content?.includes("ideal-world"));
    onText("解释 [[p65]]"); return { content: "解释 [[p65]]", toolCalls: [] };
  });
  await agent.run("解释 simulator", [], signal()); assert.equal(round, 2); assert.equal(content(), "解释 [[p65]]");
});
test("abort stops page search before any further pages are read", async () => {
  const { agent, bridge } = setup(); const controller = new AbortController(); let reads = 0;
  bridge.readPage = async i => { reads++; controller.abort(); return { pageIndex: i, pageLabel: "1", text: "x" }; };
  await assert.rejects(agent.execute("search_document", { query: "x" }, controller.signal), /停止/); assert.equal(reads, 1);
});
