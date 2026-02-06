# LaTeX Regex Lint（中文说明）

[![Release](https://img.shields.io/github/v/release/mingzhao2019/latexRegexLint)](https://github.com/mingzhao2019/latexRegexLint/releases)
[![Release Workflow](https://github.com/mingzhao2019/latexRegexLint/actions/workflows/release.yml/badge.svg)](https://github.com/mingzhao2019/latexRegexLint/actions/workflows/release.yml)

英文文档： [README.md](README.md)

这是一个 VS Code 插件，用于在 LaTeX 文档中显示**自定义正则**匹配到的问题。支持诊断等级、跨行规则、Quick Fix、行内忽略、范围禁用/启用、文件级忽略、白名单词典等功能。

## 功能概览

- **自定义正则规则**（完全由 settings.json 配置，无内置硬编码）。
- **诊断等级**：error / warning / info / hint。
- **跨行匹配**（通过 `maxLines` 控制）。
- **Quick Fix**（正则替换 + 一键忽略）。
- **行内忽略**、**范围禁用/启用**、**文件级忽略**。
- **按文件路径忽略**（glob 规则）。
- **白名单词典**（全局 + 工作区 + 外部文件）。
- **一键移除所有忽略注释**。

## 工作方式

- 默认扫描 `languageId = latex` 的文件，以及 `.tex/.ltx/.ctx/.sty`。
- 每条规则用 JavaScript `RegExp` 编译，扫描全文。
- 对每个匹配生成 diagnostics，若配置了修复则提供 Quick Fix。

### `maxLines` 跨行规则说明
- **未设置 `maxLines`**：跨行匹配会被忽略（只认单行）。
- **`maxLines` <= 0**：允许任意跨行范围。
- **`maxLines` > 0**：允许跨行上限。

## 配置示例

### 基本规则
```jsonc
"latexRegexLint.rules": [
  {
    "id": "double-spaces",
    "pattern": "\\b([A-Za-z]+)\\s{2,}([A-Za-z]+)\\b",
    "message": "检测到双空格：$1  $2",
    "severity": "Warning",
    "fix": "$1 $2"
  }
]
```

### 修复格式
- **字符串形式**（默认使用 rule.pattern）：
```jsonc
"fix": "$1 $2"
```
- **对象形式**：
```jsonc
"fix": {
  "pattern": "\\s{2,}",
  "replace": " ",
  "flags": "g"
}
```

### 行内忽略
```tex
% lint-ignore                 % 忽略本行所有规则
% lint-ignore: ruleA, ruleB    % 仅忽略指定规则
```

### 范围禁用/启用
```tex
% lint-disable
... 被忽略 ...
% lint-enable

% lint-disable: ruleA, ruleB
... 仅对 ruleA/ruleB 忽略 ...
% lint-enable: ruleA
```

### 文件级忽略
```tex
% lint-ignore-file
```

### 按文件路径忽略（glob）
```jsonc
"latexRegexLint.ignoreFiles": [
  "**/appendix.tex",
  "**/draft/**"
]
```

### 白名单词典
在规则中使用 `{{WHITELIST}}` 占位符，它会被白名单词表替换。

```jsonc
"latexRegexLint.rules": [
  {
    "id": "comma-followed",
    "pattern": ",(?=\\s+(?!(?:{{WHITELIST}})\\.?\\b)[A-Z][a-z])",
    "message": "逗号后不应直接跟大写单词",
    "severity": "Warning",
    "maxLines": 0
  }
]
```

全局白名单：
```jsonc
"latexRegexLint.whitelistWords": ["Fig", "Algorithm", "Section"],
"latexRegexLint.whitelistFiles": [".vscode/latex-whitelist.txt"]
```

规则级白名单：
```jsonc
"whitelistWords": ["Abbas", "Zhao"]
```

合并策略：
```jsonc
"latexRegexLint.whitelistMerge": true
```
设置为 `false` 时，**工作区配置会覆盖全局**，不再合并。

## 命令

- **LaTeX Regex Lint: Run** — 手动重新扫描。
- **LaTeX Regex Lint: Remove Ignore Directives** — 删除所有 `lint-ignore / lint-disable / lint-enable / lint-ignore-file` 注释。

## Quick Fix

- `Fix: <ruleId>` — 按规则修复。
- `Ignore: <ruleId>` — 自动添加 `% lint-ignore: <ruleId>`。

## 注意事项

- 需要文件语言模式是 **LaTeX** 才会生效。
- 正则语法为 JavaScript RegExp。
- 规则不触发时，先检查 `maxLines` 或是否跨行。

## 许可

MIT，参见 [LICENSE](LICENSE)。

## 发布说明

见 [GitHub Releases](https://github.com/mingzhao2019/latexRegexLint/releases)。
