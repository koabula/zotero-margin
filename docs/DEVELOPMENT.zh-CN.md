# 开发与验证

[English](DEVELOPMENT.md) · [简体中文](DEVELOPMENT.zh-CN.md)

## 常用命令

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run check` 依次执行上述检查、测试和构建。版本号来自 `package.json`；发布文件来自 `src/` 与 `addon/`。本地配置、缓存、测试入口和预览代码不进入 XPI。

## 源码结构

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 插件生命周期、原生侧栏注册、阅读器事件 |
| `src/i18n.ts`、`src/locales/` | 独立语言偏好、中英文参数化文案及界面实时更新 |
| `src/ui.ts` | 对话、设置、历史、笔记草稿 |
| `src/agent.ts` | 六项限定工具、上下文及 Agent 循环 |
| `src/provider.ts` | Chat Completions、模型列表、SSE、取消及错误处理 |
| `src/models.ts` | 多模型配置与旧配置迁移 |
| `src/selection.ts` | 文字选择、复制与流式选区保护 |
| `src/zotero.ts` | 阅读器适配、凭据和会话存储 |
| `src/markdown.ts` | Markdown、公式和来源引用 |
| `addon/` | 清单、入口、样式、图标和语言文件 |

PDF 文本、页码和选区使用 Zotero 阅读器内部接口，集中在适配层。升级 Zotero 主版本时应重新验证，不能仅修改兼容版本号。

## 多语言

语言偏好为 `extensions.margin.language`，与模型配置分开保存。`auto` 跟随 Zotero，中文环境使用 `zh-CN`，其他语言回退 `en-US`。两个资源表使用相同的中文消息 ID 和具名参数，由类型检查及测试核对资源键与参数。新增文案需要同时修改两个资源表。

纯文字使用 `t()`，需要即时切换的界面标记使用 `L()`。语言切换仅更新插件文案，保留消息节点、选区和未保存表单，不翻译文献或已有回答。资源表打包进 `plugin.js`，原生 Fluent 的中英文资源同时包含在通用 XPI。

## 长响应与续写

每次模型响应分别限制：正文 100,000 个 UTF-16 代码单元、工具名称/ID/参数合计 262,144 个单元、单个 SSE 事件或 JSON 响应 1,048,576 个单元、总传输 64 MiB。先解析完整事件，再检查残留缓存，避免把网络分片大小当成事件大小。JSON 与 SSE 达到模型长度上限时均保留正文。

连续 60 秒无数据和总计 10 分钟是两个独立时限。收到数据只刷新前者。测试注入较小阈值验证超时、取消和边界，不需要等待数分钟。

续写追加到最近一条未完成的回答，使用原模型、原问题、部分回答、来源及新消息保存的阅读上下文。仅提供只读工具，执行层也拒绝跳页和笔记操作。累计回答超过 100,000 个单元时，续写上下文保留前 4,000 与后 96,000 个单元并注明中间省略；旧会话没有保存阅读快照时使用当前阅读器信息和已有来源。不会自动重试。

## 浏览器预览

在两个终端中分别运行：

```sh
node scripts/mock-provider.mjs
```

```sh
npm run preview
```

打开 `http://127.0.0.1:18766`。预览使用生产侧栏代码与测试文献；本机模拟服务监听 `127.0.0.1:18765`。模拟模型仅验证协议和工具流程，不能替代原生布局、剪贴板或真实模型能力验收。

## 原生集成测试

先构建 XPI，再准备一个独立测试配置：

```sh
npm run build
node scripts/prepare-runtime.mjs run-1
```

脚本在 `.runtime/run-1/` 创建独立配置、文献库、测试 PDF 和测试版 XPI。保持模拟 API 运行，然后用本机 Zotero 启动该配置，例如 PowerShell：

```powershell
& 'C:\Program Files\Zotero\zotero.exe' -no-remote -profile "$PWD\.runtime\run-1\profile" -purgecaches
```

按实际安装位置修改可执行文件路径。不要使用日常阅读的 Zotero 配置运行集成脚本。

结果写入 `.runtime/run-1/result.json`。`scripts/runtime-integration.js` 只被加入测试 XPI，发布包不包含它。仓库中的 `scripts/run-runtime.ps1` 是本地便利脚本，默认 Zotero 路径为 `D:\Zotero\zotero.exe`，使用前需要检查路径。

已归档的 0.3.0 验证范围见 [VALIDATION.md](../VALIDATION.md)。浏览器测试不能替代 Zotero 内的拖选、快捷键复制、侧栏缩放及文献切换检查。

## 发布

1. 同步 `package.json`、锁文件及 `addon/manifest.json` 的版本，更新变更记录。
2. 运行 `npm run check`，完成相应的原生验收。
3. 将生成的 XPI 和 SHA-256 校验文件附到对应的 GitHub Release。
4. 更新 README 和验收记录中的版本、下载地址及验证范围。

当前采用手动安装、手动更新。清单中的 `update_url` 使用保留的 `.invalid` 域作为占位，不会从第三方获取更新；如需自动更新，应另行配置并验证实际的 HTTPS 更新清单。
