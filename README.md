# LaTeX Regex Lint

[![Release](https://img.shields.io/github/v/release/mingzhao2019/latexRegexLint)](https://github.com/mingzhao2019/latexRegexLint/releases)
[![Release Workflow](https://github.com/mingzhao2019/latexRegexLint/actions/workflows/release.yml/badge.svg)](https://github.com/mingzhao2019/latexRegexLint/actions/workflows/release.yml)
[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![中文](https://img.shields.io/badge/lang-中文-brightgreen)](README.zh.md)

A VS Code extension that surfaces **custom, user-defined regex diagnostics** for LaTeX. It supports per-rule severity, multiline matching, Quick Fixes, inline ignore directives, range disable/enable blocks, file-level ignores, and whitelist dictionaries to keep patterns readable.

## Features

- **Custom regex rules** from settings (no rules are hardcoded).
- **Diagnostics** with per-rule severity: error / warning / info / hint.
- **Multiline rules** with optional `maxLines` control.
- **Quick Fixes** for regex replacements.
- **Inline ignore** directives (line, range, or file-level).
- **Ignore by file pattern** via glob list.
- **Whitelist dictionaries** (global + workspace) and external word lists.
- **One-click ignore removal** across the workspace.

## How It Works

- The extension scans LaTeX documents (languageId `latex`) and common TeX extensions (`.tex`, `.ltx`, `.ctx`, `.sty`).
- Each rule is compiled into a JavaScript `RegExp` and matched across the whole document.
- Diagnostics are created for each match. A Quick Fix is shown if a rule defines a fix.

### Multiline behavior (`maxLines`)
- **If `maxLines` is not set**: matches that span multiple lines are ignored.
- **If `maxLines` = 0 or < 0**: unlimited span allowed.
- **If `maxLines` > 0**: allow matches spanning up to that many lines.

## Configuration

All configuration lives in `settings.json`.

### Basic rule format
```jsonc
"latexRegexLint.rules": [
  {
    "id": "double-spaces",
    "pattern": "\\b([A-Za-z]+)\\s{2,}([A-Za-z]+)\\b",
    "message": "Double space detected: $1  $2",
    "severity": "Warning",
    "fix": "$1 $2"
  }
]
```

### Fix formats
- **String fix** (uses rule pattern):
```jsonc
"fix": "$1 $2"
```
- **Object fix**:
```jsonc
"fix": {
  "pattern": "\\s{2,}",
  "replace": " ",
  "flags": "g"
}
```

### Inline ignore directives
```tex
% lint-ignore                 % ignore all rules on this line
% lint-ignore: ruleA, ruleB    % ignore only specific rules on this line
```

### Range disable/enable
```tex
% lint-disable
... ignored lines ...
% lint-enable

% lint-disable: ruleA, ruleB
... ignored for ruleA/ruleB ...
% lint-enable: ruleA
```

### File ignore
```tex
% lint-ignore-file
```

### Ignore by glob pattern
```jsonc
"latexRegexLint.ignoreFiles": [
  "**/appendix.tex",
  "**/draft/**"
]
```

### Whitelist dictionaries (external or inline)
Use the `{{WHITELIST}}` token in a pattern. It will be replaced by a word list.

```jsonc
"latexRegexLint.rules": [
  {
    "id": "comma-followed",
    "pattern": ",(?=\\s+(?!(?:{{WHITELIST}})\\.?\\b)[A-Z][a-z])",
    "message": "Comma followed by unexpected capitalized word",
    "severity": "Warning",
    "maxLines": 0
  }
]
```

Global whitelist:
```jsonc
"latexRegexLint.whitelistWords": ["Fig", "Algorithm", "Section"],
"latexRegexLint.whitelistFiles": [".vscode/latex-whitelist.txt"]
```

Rule-specific whitelist:
```jsonc
"whitelistWords": ["Abbas", "Zhao"]
```

Merge behavior:
```jsonc
"latexRegexLint.whitelistMerge": true
```
Set to `false` in a workspace to **override** global lists instead of merging.

## Commands

- **LaTeX Regex Lint: Run** — manual re-scan.
- **LaTeX Regex Lint: Remove Ignore Directives** — strips `lint-ignore`, `lint-disable`, `lint-enable`, `lint-ignore-file` comments from matched files.

## Quick Fixes

- `Fix: <ruleId>` — applies the regex replacement for the matched range.
- `Ignore: <ruleId>` — appends `% lint-ignore: <ruleId>` on the same line.

## Tips

- Use `maxLines` for multiline rules to avoid large spans.
- Keep `{{WHITELIST}}` lists in external files to avoid massive regex literals.
- Use workspace settings to scope special-case vocab.

## Troubleshooting

- If a rule doesn't trigger, confirm the file language mode is **LaTeX**.
- Make sure the regex is valid JavaScript RegExp syntax.
- If patterns look correct but nothing matches, try removing `maxLines` first.
