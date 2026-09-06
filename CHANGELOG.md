# 0.3.1 — 2026-09-06

- Fixed premature stream cancellation caused by counting SSE protocol overhead against a 2 MB limit. Content, event, tool, and transfer protections now have separate budgets.
- Replaced the fixed two-minute deadline with independent 60-second idle and 10-minute total request deadlines.
- Distinguished interruption causes and preserved partial answers for both JSON and streaming model length limits.
- Added **Continue generating** for the latest incomplete answer. It appends using the original model, question, partial text, and sources while retaining unsent drafts. Continuation cannot navigate or save notes, including unoffered calls from a model.
- Added long-stream, chunk-boundary, timeout, partial-answer, and continuation regressions. Updated bilingual documentation.

中文：修复 SSE 协议开销导致的过早截断；区分无数据超时与总时限；保留部分回答并支持使用原模型继续生成，续写仅可查阅原文。

# 0.3.0 — 2026-09-06

- Added English and Simplified Chinese in one universal XPI. Follow Zotero by default, or change the language independently in settings.
- Language changes update open panels while preserving drafts, models, conversation content, and streaming selections.
- Fixed overlapping conversation history entries caused by Zotero's fixed native button height. Titles clamp to two lines; dates and message counts wrap with content-driven row height.
- Added an English project homepage and development guide, with linked Chinese versions.
- Validated with 37 automated tests and isolated native Zotero 10.0.1 integration. Model tests use a local mock service, not a real LLM.
- Updates remain manual; no automatic update mechanism was added.

中文：单包增加中英文切换，修复历史条目重叠，提供双语首页与开发说明。语言独立保存，切换保留草稿、模型及流式选区。

# 0.2.0

- 助手独占右侧内容区并自适应尺寸，保留 Zotero 导航和原生面板设置。
- 固定 Mono Light 黑白灰界面，简化标题、设置及聊天布局。
- 修复文字拖选、快捷键和右键复制；流式更新保护选区，已完成消息保留 DOM。
- 获取模型列表、手动添加、多选和默认模型；每个会话可切换并记住模型。
- 保留旧模型配置、密钥、输入草稿和历史；新回答显示实际使用的模型。

安装包及使用方法见 README.md，验证范围见 VALIDATION.md。
