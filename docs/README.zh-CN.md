# margins

[English](../README.md) · **简体中文** · [日本語](README.ja.md)

> 这是英文 README 的精简翻译。完整、最新的说明以[英文版](../README.md)为准。

在终端里一条命令，就能在浏览器中打开任意一个 Markdown 文件夹。以目录树浏览，
渲染后阅读，在文件之间跳转链接（包括 `[[wikilinks]]`），边写边预览，还能全文搜索。
看完关掉标签页，它就自动退出。

```bash
npm install -g margins

cd ~/notes
margins
```

不用创建知识库，不用安装应用，不用账号，也不用任何配置。margins 唯一会写进文件夹
的，只有你保存的文件。

## 它能做什么

- **浏览**：以目录树查看文件夹，Markdown 优先，其他文本文件和图片也在。
- **阅读**：GitHub 风格的 Markdown，包括表格、任务列表、代码块、文件夹里的图片，
  以及 README 常用的 HTML。
- **跳转链接**：既支持 GitHub 式的 `[文字](other.md#section)`，也支持 Obsidian 式的
  `[[Other]]`、`[[Other#Section]]`、`[[Other|别名]]`。
- **反向链接**：每篇笔记都会列出链接到它的笔记，以及链接所在的那一行。
- **编辑**：源码和实时预览并排，`Ctrl/Cmd+S` 保存。
- **搜索**：`Ctrl/Cmd+P` 按文件名打开，`Ctrl/Cmd+Shift+F` 搜索所有文件。
- **跟上外部修改**：在 vim、VS Code 或智能体里改了文件，页面两秒内就会更新；
  如果你打开后文件在磁盘上被改过，保存时不会覆盖，而是问你保留哪一版。

## 在智能体里使用

编程智能体会写大量 Markdown：计划、设计、报告、笔记。作为插件安装后，智能体会
直接用 margins 帮你打开，而不是把一大段文字贴进对话里。

```
/plugin install margins --marketplace dheerajjha/margins
```

以上是 Claude Code。装好后让它“用 margins 打开计划或文档”，或运行
`/margins:read docs/`。同一个技能也能装到别的智能体里：

| 智能体 | 安装 |
|---|---|
| Codex CLI | `codex plugin marketplace add dheerajjha/margins`，然后 `codex plugin add margins@margins` |
| Cursor | **Customize** → **From GitHub Repository** → `dheerajjha/margins` |
| Copilot CLI | `copilot plugin marketplace add dheerajjha/margins`，然后 `copilot plugin install margins@margins` |
| 其他 | `npx skills add dheerajjha/margins` |

## 用法

```
margins [路径] [选项]
```

| 选项 | 作用 |
|---|---|
| `-p, --port <n>` | 监听端口，默认 4600；被占用时自动换一个 |
| `--hidden` | 显示以点开头的隐藏文件和文件夹 |
| `--no-open` | 只打印地址，不打开浏览器 |

## 安全

margins 本来就是要打开你没写过的文件夹，比如克隆下来的仓库，而且它能写文件，所以
它假定文件夹可能是恶意的：Markdown 里的内容无法执行脚本；文件夹之外的文件读不到也
写不了；`.git` 和 `node_modules` 永远不会被打开或写入；它只监听 `127.0.0.1`，其他
网站无法利用它。详情见[英文 README](../README.md)。

## 许可证

MIT
