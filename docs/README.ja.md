# margins

[English](../README.md) · [简体中文](README.zh-CN.md) · **日本語**

> 英語版 README の要約翻訳です。正確で最新の内容は[英語版](../README.md)を参照してください。

ターミナルからコマンド一つで、Markdown のフォルダをブラウザで開きます。ツリーで
眺め、レンダリングされた状態で読み、ファイル間のリンク(`[[wikilinks]]` も含む)を
たどり、ライブプレビュー付きで編集し、全体を検索できます。タブを閉じれば終了します。

```bash
npm install -g margins

cd ~/notes
margins
```

保管庫(vault)の作成も、アプリのインストールも、アカウントも、設定も要りません。
margins がフォルダに書き込むのは、あなたが保存したファイルだけです。

## できること

- **眺める**: フォルダをツリーで表示。Markdown が先頭で、他のテキストや画像もあります。
- **読む**: 表、タスクリスト、コードブロック、フォルダ内の画像、README でよく使う
  HTML を含む GitHub 風 Markdown。
- **リンクをたどる**: GitHub 式の `[テキスト](other.md#section)` と、Obsidian 式の
  `[[Other]]`、`[[Other#Section]]`、`[[Other|別名]]` の両方。
- **バックリンク**: そのノートにリンクしているノートと、リンクしている行を表示します。
- **編集**: ソースとライブプレビューを並べて表示。`Ctrl/Cmd+S` で保存。
- **検索**: `Ctrl/Cmd+P` でファイル名から開き、`Ctrl/Cmd+Shift+F` で全ファイルを検索。
- **外部の変更に追従**: vim や VS Code やエージェントでファイルを変えると、2 秒以内に
  画面が更新されます。開いた後にディスク上で変わったファイルは、保存しても上書きせず、
  どちらを残すか尋ねます。

## エージェントから使う

コーディングエージェントは計画、設計、レポート、メモなど大量の Markdown を書きます。
プラグインとして入れると、チャットに長文を貼る代わりに margins で開いてくれます。

```
/plugin install margins --marketplace dheerajjha/margins
```

これは Claude Code の場合です。入れたら「計画(またはドキュメント)を margins で
開いて」と頼むか、`/margins:read docs/` を実行します。同じスキルは他のエージェント
にも入ります。

| エージェント | インストール |
|---|---|
| Codex CLI | `codex plugin marketplace add dheerajjha/margins` のあと `codex plugin add margins@margins` |
| Cursor | **Customize** → **From GitHub Repository** → `dheerajjha/margins` |
| Copilot CLI | `copilot plugin marketplace add dheerajjha/margins` のあと `copilot plugin install margins@margins` |
| その他 | `npx skills add dheerajjha/margins` |

## 使い方

```
margins [パス] [オプション]
```

| オプション | 内容 |
|---|---|
| `-p, --port <n>` | 待ち受けポート(既定は 4600。使用中なら空いているものを選びます) |
| `--hidden` | ドットで始まる隠しファイル・フォルダも表示する |
| `--no-open` | ブラウザを開かずアドレスだけ表示する |

## 安全性

margins はクローンしたリポジトリなど、自分で書いていないフォルダを開くためのもので、
しかもファイルを書き込めます。そのためフォルダが悪意を持っている前提で作られています。
Markdown の中身がスクリプトを実行することはなく、フォルダの外は読むことも書くことも
できず、`.git` と `node_modules` は決して開いたり書いたりしません。待ち受けは
`127.0.0.1` だけで、他のウェブサイトからは使えません。詳しくは
[英語版 README](../README.md) をご覧ください。

## ライセンス

MIT
