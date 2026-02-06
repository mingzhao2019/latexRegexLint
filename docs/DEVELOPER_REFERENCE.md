# Developer Reference — LaTeX Regex Lint

## Purpose
This extension provides configurable regex-based diagnostics for LaTeX documents, with inline ignore controls, range enable/disable, file-level ignores, Quick Fixes, and optional whitelist dictionaries.

## Original Requirements Summary
- Allow **user-defined regex rules** (no hardcoded rules).
- Show diagnostics as warning/error/info/hint.
- Support **line-level ignores** and optionally Quick Fixes.
- Add **range ignore** (disable/enable) and **file ignore**.
- Provide a **command to remove ignore directives** before publishing.
- Support **whitelist dictionaries** to simplify long negative lookaheads.
- Package as a VSIX and prepare for GitHub release.

## Key Design Choices
- **Config-first**: all behavior is controlled from `settings.json`.
- **Whole-document scanning**: required for multiline regex rules.
- **Match span control**: `maxLines` controls cross-line matches.
- **Directive parsing**: LaTeX comments detected by `%` not escaped by `\`.
- **Whitelist token**: `{{WHITELIST}}` in patterns is replaced at runtime with escaped word lists.
- **Scope merging**: whitelist can merge (global + workspace) or override.

## File Structure
- `src/extension.ts` — main extension logic.
- `package.json` — manifest + configuration schema.
- `README.md` / `README.zh.md` — user docs.
- `docs/DEVELOPER_REFERENCE.md` — this file.
- `media/logo.png` — extension icon.

## Configuration Keys
All values are supported both as:
- `"latexRegexLint.<key>"` (dotted keys), and
- nested `"latexRegexLint": { ... }` objects.

Important keys:
- `latexRegexLint.rules`: regex rule array
- `latexRegexLint.ignoreToken`: line ignore token
- `latexRegexLint.disableToken` / `enableToken`: range disable/enable tokens
- `latexRegexLint.ignoreFileToken`: file ignore token
- `latexRegexLint.ignoreFiles`: glob list of files to skip
- `latexRegexLint.whitelistWords`: global whitelist word list
- `latexRegexLint.whitelistFiles`: external word list files
- `latexRegexLint.whitelistMerge`: merge vs override across scopes

Rule fields:
- `id` or `name`
- `pattern` (JS regex string)
- `flags`
- `message`
- `severity`: error | warning | info | hint
- `fix`: string (replace) or object `{ pattern, replace, flags }`
- `maxLines`: line-span limit for multiline matches
- `whitelistWords`: rule-specific whitelist (merged with global)

## Core Logic (src/extension.ts)

### 1) Document filtering
- Lints `languageId=latex` or files with known TeX extensions.
- Skips files matched by `ignoreFiles` glob patterns.

### 2) Rule compilation
- `compileRules` builds `RegExp` from each rule.
- If rule contains `{{WHITELIST}}`, it is replaced by a merged list of words.
- Invalid regex is logged to the extension output channel.

### 3) Ignore state
- `buildIgnoreState` computes per-line ignore status:
  - `lint-ignore` (line only)
  - `lint-disable` / `lint-enable` (range)
  - `lint-ignore-file`
- Range directives persist until re-enabled.

### 4) Diagnostics
- Scans the entire document to allow multiline regex.
- Applies `maxLines` filtering for cross-line matches.
- Applies ignore state per line span.

### 5) Code Actions
- Quick Fix: regex replacement when `rule.fix` is provided.
- Ignore: inserts `% lint-ignore: <ruleId>` at the end of the line.

### 6) Remove Ignore Directives
- `LaTeX Regex Lint: Remove Ignore Directives` command
- Walks all TeX files and strips ignore tokens from comments.

## Build & Release

### Build
```bash
npm install
npm run compile
```

### Package (VSIX)
```bash
npx vsce package
```
Output: `latex-regex-lint-0.0.1.vsix`

Note: update the `repository.url` in `package.json` before publishing to the marketplace.

### Install locally
```bash
code --install-extension latex-regex-lint-0.0.1.vsix
```

## Common Extensions & Notes
- To add new settings, update `package.json` schema and `getSectionSettings`.
- For additional directives, update `parseLineDirectives` + removal logic.
- Keep regex operations defensive to avoid infinite loops (`lastIndex` handling is already implemented).

## Testing Checklist
- Rule matches show diagnostics.
- `maxLines` behavior works for single-line vs multiline.
- `lint-ignore`, `lint-disable`, `lint-enable`, `lint-ignore-file` all work.
- `ignoreFiles` glob skips files as expected.
- Whitelist replacement works for global + workspace + per-rule.
- Quick Fix applies replacement correctly.
- Remove Ignore Directives removes all ignore tokens.

## Future Improvements
- Add official tests with `@vscode/test-electron`.
- Bundle with esbuild and create `.vscodeignore` for smaller packages.
- Add telemetry-safe logging or rule validation UI.
