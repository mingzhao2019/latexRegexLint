import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { minimatch } from "minimatch";

const CONFIG_SECTION = "latexRegexLint";
const DIAGNOSTIC_SOURCE = "latexRegexLint";

interface RuleFix {
  pattern: string;
  replace: string;
  flags?: string;
}

interface RawRuleConfig {
  id?: string;
  name?: string;
  pattern: string;
  flags?: string;
  message?: string;
  severity?: string;
  fix?: RuleFix | string;
  maxLines?: number;
  whitelistWords?: string[];
}

interface RuleConfig {
  id: string;
  pattern: string;
  flags?: string;
  message?: string;
  severity?: string;
  fix?: RuleFix;
  maxLines?: number;
  whitelistWords?: string[];
}

interface CompiledRule {
  rule: RuleConfig;
  regex: RegExp;
}

interface IgnoreInfo {
  ignoreAll: boolean;
  ignoreRules: Set<string>;
}

interface SectionSettings {
  rules: RawRuleConfig[];
  ignoreToken: string;
  disableToken: string;
  enableToken: string;
  ignoreFileToken: string;
  fileExtensions: string[];
  ignoreFiles: string[];
  whitelistWords: string[];
  whitelistFiles: string[];
  whitelistMerge: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  const output = vscode.window.createOutputChannel("LaTeX Regex Lint");

  const lintActive = () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc) {
      lintDocument(doc, diagnostics, output);
    }
  };

  context.subscriptions.push(
    diagnostics,
    output,
    vscode.workspace.onDidOpenTextDocument((doc) => lintDocument(doc, diagnostics, output)),
    vscode.workspace.onDidChangeTextDocument((event) => lintDocument(event.document, diagnostics, output)),
    vscode.workspace.onDidSaveTextDocument((doc) => lintDocument(doc, diagnostics, output)),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        for (const doc of vscode.workspace.textDocuments) {
          lintDocument(doc, diagnostics, output);
        }
      }
    }),
    vscode.commands.registerCommand("latexRegexLint.run", () => {
      for (const doc of vscode.workspace.textDocuments) {
        lintDocument(doc, diagnostics, output);
      }
      lintActive();
    }),
    vscode.commands.registerCommand("latexRegexLint.removeIgnores", async () => {
      await removeIgnoreDirectives();
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ language: "latex" }, { scheme: "file" }, { scheme: "untitled" }],
      new LintFixProvider(),
      { providedCodeActionKinds: LintFixProvider.providedCodeActionKinds }
    )
  );

  for (const doc of vscode.workspace.textDocuments) {
    lintDocument(doc, diagnostics, output);
  }
}

export function deactivate(): void {
  // No-op
}

function lintDocument(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  output: vscode.OutputChannel
): void {
  const settings = getSectionSettings();

  if (!shouldLintDocument(document, settings.fileExtensions, settings.ignoreFiles)) {
    diagnostics.delete(document.uri);
    return;
  }

  const rules = getRuleConfigs(settings);
  if (!rules.length) {
    diagnostics.delete(document.uri);
    return;
  }

  const whitelist = getWhitelistWords(settings, document);
  const compiledRules = compileRules(rules, whitelist, output);
  if (!compiledRules.length) {
    diagnostics.delete(document.uri);
    return;
  }

  const ignoreState = buildIgnoreState(document, settings);
  if (ignoreState.fileIgnored) {
    diagnostics.delete(document.uri);
    return;
  }

  const text = document.getText();
  const results: vscode.Diagnostic[] = [];

  for (const compiled of compiledRules) {
    const regex = resetRegex(compiled.regex);
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(text)) !== null) {
      const matchText = match[0] ?? "";
      if (matchText.length === 0) {
        regex.lastIndex += 1;
        continue;
      }

      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + matchText.length);

      if (shouldSkipByLineSpan(compiled.rule.maxLines, startPos.line, endPos.line)) {
        continue;
      }

      if (isIgnoredRange(ignoreState.ignoreByLine, compiled.rule.id, startPos.line, endPos.line)) {
        continue;
      }

      const range = new vscode.Range(startPos, endPos);
      const message = compiled.rule.message ?? `Pattern matched: ${compiled.rule.id}`;
      const severity = parseSeverity(compiled.rule.severity);
      const diagnostic = new vscode.Diagnostic(range, message, severity);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = compiled.rule.id;

      results.push(diagnostic);
    }
  }

  diagnostics.set(document.uri, results);
}

function shouldLintDocument(
  document: vscode.TextDocument,
  fileExtensions: string[],
  ignoreFiles: string[]
): boolean {
  if (document.languageId === "latex") {
    return !isIgnoredByPattern(document, ignoreFiles);
  }

  if (document.isUntitled) {
    return false;
  }

  const ext = path.extname(document.fileName);
  return fileExtensions.includes(ext) && !isIgnoredByPattern(document, ignoreFiles);
}

function getSectionSettings(): SectionSettings {
  const rootConfig = vscode.workspace.getConfiguration();
  const sectionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const nested = rootConfig.get<Partial<SectionSettings>>(CONFIG_SECTION);

  const rules = Array.isArray(nested?.rules)
    ? nested?.rules
    : sectionConfig.get<RawRuleConfig[]>("rules", []);

  const ignoreToken = typeof nested?.ignoreToken === "string"
    ? nested.ignoreToken
    : sectionConfig.get<string>("ignoreToken", "lint-ignore");

  const disableToken = typeof nested?.disableToken === "string"
    ? nested.disableToken
    : sectionConfig.get<string>("disableToken", "lint-disable");

  const enableToken = typeof nested?.enableToken === "string"
    ? nested.enableToken
    : sectionConfig.get<string>("enableToken", "lint-enable");

  const ignoreFileToken = typeof nested?.ignoreFileToken === "string"
    ? nested.ignoreFileToken
    : sectionConfig.get<string>("ignoreFileToken", "lint-ignore-file");

  const fileExtensions = Array.isArray(nested?.fileExtensions)
    ? nested.fileExtensions
    : sectionConfig.get<string[]>("fileExtensions", [".tex", ".ltx", ".ctx", ".sty"]);

  const ignoreFiles = Array.isArray(nested?.ignoreFiles)
    ? nested.ignoreFiles
    : sectionConfig.get<string[]>("ignoreFiles", []);

  const whitelistMerge = getMergedBooleanSetting("whitelistMerge", "whitelistMerge", true);
  const mergedWhitelistWords = getMergedArraySetting(
    "whitelistWords",
    "whitelistWords",
    [],
    whitelistMerge
  );

  const mergedWhitelistFiles = getMergedArraySetting(
    "whitelistFiles",
    "whitelistFiles",
    [],
    whitelistMerge
  );

  return {
    rules,
    ignoreToken,
    disableToken,
    enableToken,
    ignoreFileToken,
    fileExtensions,
    ignoreFiles,
    whitelistWords: mergedWhitelistWords,
    whitelistFiles: mergedWhitelistFiles,
    whitelistMerge
  };
}

function getRuleConfigs(settings: SectionSettings): RuleConfig[] {
  return normalizeRules(settings.rules);
}

function normalizeRules(rules: RawRuleConfig[]): RuleConfig[] {
  const normalized: RuleConfig[] = [];

  rules.forEach((rule, index) => {
    if (!rule.pattern) {
      return;
    }

    const id = rule.id ?? rule.name ?? `rule-${index + 1}`;
    let fix: RuleFix | undefined;

    if (typeof rule.fix === "string") {
      fix = { pattern: rule.pattern, replace: rule.fix };
    } else if (rule.fix && typeof rule.fix === "object") {
      if (rule.fix.pattern && rule.fix.replace !== undefined) {
        fix = { pattern: rule.fix.pattern, replace: rule.fix.replace, flags: rule.fix.flags };
      }
    }

    normalized.push({
      id,
      pattern: rule.pattern,
      flags: rule.flags,
      message: rule.message,
      severity: rule.severity,
      fix,
      maxLines: rule.maxLines,
      whitelistWords: rule.whitelistWords
    });
  });

  return normalized;
}

function compileRules(
  rules: RuleConfig[],
  whitelist: string[],
  output: vscode.OutputChannel
): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  for (const rule of rules) {
    const ruleWhitelist = mergeUnique(whitelist, rule.whitelistWords ?? []);
    const pattern = applyWhitelist(rule.pattern, ruleWhitelist);
    const regex = buildRegex(pattern, rule.flags);
    if (!regex) {
      output.appendLine(`Invalid regex for rule '${rule.id}': ${pattern}`);
      continue;
    }

    compiled.push({ rule: { ...rule, pattern }, regex });
  }

  return compiled;
}

function buildRegex(pattern: string, flags?: string): RegExp | null {
  try {
    const finalFlags = ensureGlobalFlag(flags);
    return new RegExp(pattern, finalFlags);
  } catch {
    return null;
  }
}

function ensureGlobalFlag(flags?: string): string {
  const base = flags ?? "";
  if (base.includes("g")) {
    return base;
  }
  return base + "g";
}

function resetRegex(regex: RegExp): RegExp {
  regex.lastIndex = 0;
  return regex;
}

function parseSeverity(input?: string): vscode.DiagnosticSeverity {
  switch ((input ?? "warning").toLowerCase()) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    case "hint":
      return vscode.DiagnosticSeverity.Hint;
    case "warning":
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

function buildIgnoreState(
  document: vscode.TextDocument,
  settings: SectionSettings
): { ignoreByLine: IgnoreInfo[]; fileIgnored: boolean } {
  const ignoreByLine: IgnoreInfo[] = [];
  let fileIgnored = false;
  let activeIgnoreAll = false;
  const activeIgnoreRules = new Set<string>();

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const directives = parseLineDirectives(lineText, settings);

    if (directives.ignoreFile) {
      fileIgnored = true;
    }

    const ignoreRules = new Set<string>();
    directives.ignoreLineRules.forEach((rule) => ignoreRules.add(rule));
    activeIgnoreRules.forEach((rule) => ignoreRules.add(rule));
    directives.disableRules.forEach((rule) => ignoreRules.add(rule));

    const ignoreAll = directives.ignoreLineAll || activeIgnoreAll || directives.disableAll;
    ignoreByLine.push({ ignoreAll, ignoreRules });

    if (directives.enableAll) {
      activeIgnoreAll = false;
      activeIgnoreRules.clear();
    }

    directives.enableRules.forEach((rule) => activeIgnoreRules.delete(rule));

    if (directives.disableAll) {
      activeIgnoreAll = true;
    }

    directives.disableRules.forEach((rule) => activeIgnoreRules.add(rule));
  }

  return { ignoreByLine, fileIgnored };
}

function parseLineDirectives(lineText: string, settings: SectionSettings): {
  ignoreLineAll: boolean;
  ignoreLineRules: Set<string>;
  disableAll: boolean;
  disableRules: Set<string>;
  enableAll: boolean;
  enableRules: Set<string>;
  ignoreFile: boolean;
} {
  const ignoreLineRules = new Set<string>();
  const disableRules = new Set<string>();
  const enableRules = new Set<string>();

  const commentIndex = findCommentIndex(lineText);
  if (commentIndex === -1) {
    return {
      ignoreLineAll: false,
      ignoreLineRules,
      disableAll: false,
      disableRules,
      enableAll: false,
      enableRules,
      ignoreFile: false
    };
  }

  const commentText = lineText.slice(commentIndex + 1);

  const ignore = parseToken(commentText, settings.ignoreToken);
  const disable = parseToken(commentText, settings.disableToken);
  const enable = parseToken(commentText, settings.enableToken);
  const ignoreFile = parseToken(commentText, settings.ignoreFileToken);

  if (ignore.rules) {
    ignore.rules.forEach((rule) => ignoreLineRules.add(rule));
  }

  if (disable.rules) {
    disable.rules.forEach((rule) => disableRules.add(rule));
  }

  if (enable.rules) {
    enable.rules.forEach((rule) => enableRules.add(rule));
  }

  return {
    ignoreLineAll: ignore.found && !ignore.rules,
    ignoreLineRules,
    disableAll: disable.found && !disable.rules,
    disableRules,
    enableAll: enable.found && !enable.rules,
    enableRules,
    ignoreFile: ignoreFile.found
  };
}

function parseToken(commentText: string, token: string): { found: boolean; rules?: string[] } {
  if (!token) {
    return { found: false };
  }

  const escaped = escapeRegExp(token);
  const regex = new RegExp(`${escaped}(?:\\s*:\\s*([A-Za-z0-9_-]+(?:\\s*,\\s*[A-Za-z0-9_-]+)*))?`, "i");
  const match = commentText.match(regex);
  if (!match) {
    return { found: false };
  }

  const list = match[1];
  if (!list) {
    return { found: true };
  }

  const rules = list
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return { found: true, rules };
}

function findCommentIndex(lineText: string): number {
  for (let i = 0; i < lineText.length; i += 1) {
    if (lineText[i] === "%") {
      if (i === 0 || lineText[i - 1] !== "\\") {
        return i;
      }
    }
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIgnoredByPattern(document: vscode.TextDocument, ignoreFiles: string[]): boolean {
  if (!ignoreFiles.length || document.isUntitled) {
    return false;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return false;
  }

  const relativePath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
  return ignoreFiles.some((pattern) => minimatch(relativePath, pattern.replace(/\\/g, "/"), { dot: true, nocase: true }));
}

function getWhitelistWords(settings: SectionSettings, document: vscode.TextDocument): string[] {
  const words = new Set<string>();
  settings.whitelistWords.forEach((word) => {
    if (word && word.trim()) {
      words.add(word.trim());
    }
  });

  const files = resolveWhitelistFiles(settings, document);
  files.forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"))
      .forEach((line) => words.add(line));
  });

  return Array.from(words);
}

function resolveWhitelistFiles(settings: SectionSettings, document: vscode.TextDocument): string[] {
  if (!settings.whitelistFiles.length) {
    return [];
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
  return settings.whitelistFiles.map((filePath) => {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    if (workspaceFolder) {
      return path.join(workspaceFolder.uri.fsPath, filePath);
    }
    return filePath;
  });
}

function applyWhitelist(pattern: string, words: string[]): string {
  const token = "{{WHITELIST}}";
  if (!pattern.includes(token)) {
    return pattern;
  }

  if (!words.length) {
    return pattern.replace(token, "\\\\b\\\\B");
  }

  const escaped = words.map((word) => escapeRegExp(word)).join("|");
  return pattern.replace(token, escaped);
}

function mergeUnique(primary: string[], secondary: string[]): string[] {
  const merged = new Set<string>();
  primary.forEach((item) => merged.add(item));
  secondary.forEach((item) => merged.add(item));
  return Array.from(merged);
}

function getMergedArraySetting(
  key: string,
  nestedKey: keyof SectionSettings,
  fallback: string[],
  merge: boolean
): string[] {
  const sectionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const rootInspect = vscode.workspace.getConfiguration().inspect<Partial<SectionSettings>>(CONFIG_SECTION);
  const dottedInspect = sectionConfig.inspect<string[]>(key);

  const values: string[] = [];

  const addArray = (arr?: string[]) => {
    if (Array.isArray(arr)) {
      arr.forEach((item) => {
        if (item && item.trim()) {
          values.push(item.trim());
        }
      });
    }
  };

  if (merge) {
    addArray(dottedInspect?.globalValue);
    addArray(dottedInspect?.workspaceValue);
    addArray(dottedInspect?.workspaceFolderValue);
  } else {
    addArray(dottedInspect?.workspaceFolderValue ?? dottedInspect?.workspaceValue ?? dottedInspect?.globalValue);
  }

  const nestedScopes = [rootInspect?.globalValue, rootInspect?.workspaceValue, rootInspect?.workspaceFolderValue];
  if (merge) {
    nestedScopes.forEach((scopeValue) => {
      if (scopeValue && Array.isArray((scopeValue as Partial<SectionSettings>)[nestedKey] as string[])) {
        addArray((scopeValue as Partial<SectionSettings>)[nestedKey] as string[]);
      }
    });
  } else {
    const scoped = rootInspect?.workspaceFolderValue ?? rootInspect?.workspaceValue ?? rootInspect?.globalValue;
    if (scoped && Array.isArray((scoped as Partial<SectionSettings>)[nestedKey] as string[])) {
      addArray((scoped as Partial<SectionSettings>)[nestedKey] as string[]);
    }
  }

  if (!values.length) {
    return fallback;
  }

  return mergeUnique(values, []);
}

function getMergedBooleanSetting(
  key: string,
  nestedKey: keyof SectionSettings,
  fallback: boolean
): boolean {
  const sectionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const rootInspect = vscode.workspace.getConfiguration().inspect<Partial<SectionSettings>>(CONFIG_SECTION);
  const dottedInspect = sectionConfig.inspect<boolean>(key);

  const value =
    dottedInspect?.workspaceFolderValue ??
    dottedInspect?.workspaceValue ??
    dottedInspect?.globalValue ??
    (rootInspect?.workspaceFolderValue as Partial<SectionSettings> | undefined)?.[nestedKey] ??
    (rootInspect?.workspaceValue as Partial<SectionSettings> | undefined)?.[nestedKey] ??
    (rootInspect?.globalValue as Partial<SectionSettings> | undefined)?.[nestedKey];

  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function isIgnoredRange(ignoreByLine: IgnoreInfo[], ruleId: string, startLine: number, endLine: number): boolean {
  for (let line = startLine; line <= endLine && line < ignoreByLine.length; line += 1) {
    const info = ignoreByLine[line];
    if (!info) {
      continue;
    }
    if (info.ignoreAll || info.ignoreRules.has(ruleId)) {
      return true;
    }
  }
  return false;
}

function shouldSkipByLineSpan(maxLines: number | undefined, startLine: number, endLine: number): boolean {
  const span = endLine - startLine;
  if (maxLines === undefined) {
    return span > 0;
  }
  if (maxLines <= 0) {
    return false;
  }
  return span > maxLines;
}

class LintFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const settings = getSectionSettings();
    const rules = getRuleConfigs(settings);
    const ruleMap = new Map<string, RuleConfig>(rules.map((rule) => [rule.id, rule]));

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      const ruleId = extractRuleId(diagnostic.code);
      if (!ruleId) {
        continue;
      }

      const rule = ruleMap.get(ruleId);
      if (!rule?.fix) {
        const ignoreAction = buildIgnoreAction(document, diagnostic, settings.ignoreToken, ruleId);
        if (ignoreAction) {
          actions.push(ignoreAction);
        }
      } else {
        const fixAction = buildFixAction(document, diagnostic, rule);
        if (fixAction) {
          actions.push(fixAction);
        }
        const ignoreAction = buildIgnoreAction(document, diagnostic, settings.ignoreToken, ruleId);
        if (ignoreAction) {
          actions.push(ignoreAction);
        }
      }
    }

    return actions;
  }
}

function extractRuleId(code: string | number | { value: string | number } | undefined): string | null {
  if (!code) {
    return null;
  }

  if (typeof code === "string" || typeof code === "number") {
    return String(code);
  }

  if (typeof code === "object" && "value" in code) {
    return String(code.value);
  }

  return null;
}

function buildFixAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  rule: RuleConfig
): vscode.CodeAction | null {
  if (!rule.fix) {
    return null;
  }

  const fixRegex = buildRegex(rule.fix.pattern, rule.fix.flags ?? rule.flags);
  if (!fixRegex) {
    return null;
  }

  const diagRange = diagnostic.range;
  const diagText = document.getText(diagRange);
  const fixedText = diagText.replace(fixRegex, rule.fix.replace);

  if (fixedText === diagText) {
    return null;
  }

  const action = new vscode.CodeAction(`Fix: ${rule.id}`, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.isPreferred = true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, diagRange, fixedText);
  action.edit = edit;

  return action;
}

function buildIgnoreAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  token: string,
  ruleId: string
): vscode.CodeAction | null {
  const line = document.lineAt(diagnostic.range.start.line);
  const updatedLine = buildIgnoredLineText(line.text, token, ruleId);

  if (!updatedLine || updatedLine === line.text) {
    return null;
  }

  const action = new vscode.CodeAction(`Ignore: ${ruleId}`, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, updatedLine);
  action.edit = edit;

  return action;
}

function buildIgnoredLineText(lineText: string, token: string, ruleId: string): string | null {
  const commentIndex = findCommentIndex(lineText);
  if (commentIndex === -1) {
    return `${lineText} % ${token}: ${ruleId}`;
  }

  const commentText = lineText.slice(commentIndex + 1);
  const tokenIndex = commentText.indexOf(token);
  if (tokenIndex === -1) {
    return `${lineText} % ${token}: ${ruleId}`;
  }

  const tokenAbsIndex = commentIndex + 1 + tokenIndex;
  const afterTokenStart = tokenAbsIndex + token.length;
  const afterTokenText = lineText.slice(afterTokenStart);

  const ruleListMatch = afterTokenText.match(/^\s*:\s*([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)/);
  if (!ruleListMatch) {
    return null;
  }

  const existing = ruleListMatch[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (existing.includes(ruleId)) {
    return null;
  }

  const updatedList = `${ruleListMatch[1]}, ${ruleId}`;
  const prefix = ruleListMatch[0].replace(ruleListMatch[1], updatedList);
  const rest = afterTokenText.slice(ruleListMatch[0].length);

  return lineText.slice(0, afterTokenStart) + prefix + rest;
}

async function removeIgnoreDirectives(): Promise<void> {
  const settings = getSectionSettings();
  const tokens = [
    settings.ignoreToken,
    settings.disableToken,
    settings.enableToken,
    settings.ignoreFileToken
  ].filter((value) => value.length > 0);

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    await applyIgnoreRemoval(editor.document, tokens);
    return;
  }

  const include = buildIncludeGlob(settings.fileExtensions);
  const files = await vscode.workspace.findFiles(include);
  let updatedCount = 0;

  const edit = new vscode.WorkspaceEdit();
  for (const uri of files) {
    const document = await vscode.workspace.openTextDocument(uri);
    const updated = stripIgnoreDirectives(document.getText(), document.eol, tokens);
    if (updated !== document.getText()) {
      edit.replace(document.uri, fullRange(document), updated);
      updatedCount += 1;
    }
  }

  if (updatedCount > 0) {
    await vscode.workspace.applyEdit(edit);
  }
}

async function applyIgnoreRemoval(document: vscode.TextDocument, tokens: string[]): Promise<void> {
  const updated = stripIgnoreDirectives(document.getText(), document.eol, tokens);
  if (updated === document.getText()) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange(document), updated);
  await vscode.workspace.applyEdit(edit);
}

function stripIgnoreDirectives(text: string, eol: vscode.EndOfLine, tokens: string[]): string {
  const lineEnding = eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  const cleaned = lines.map((line) => stripIgnoreFromLine(line, tokens));
  return cleaned.join(lineEnding);
}

function stripIgnoreFromLine(lineText: string, tokens: string[]): string {
  const commentIndex = findCommentIndex(lineText);
  if (commentIndex === -1) {
    return lineText;
  }

  const commentText = lineText.slice(commentIndex + 1);
  const directiveRegex = buildDirectiveRegex(tokens);
  if (!directiveRegex) {
    return lineText;
  }

  const replaced = commentText.replace(directiveRegex, " ");
  if (replaced === commentText) {
    return lineText;
  }

  const cleanedComment = replaced
    .replace(/\s{2,}/g, " ")
    .trim();

  const prefix = lineText.slice(0, commentIndex).replace(/\s+$/, "");
  if (cleanedComment.length === 0) {
    return prefix;
  }

  if (prefix.length === 0) {
    return `% ${cleanedComment}`;
  }

  return `${prefix} % ${cleanedComment}`;
}

function buildDirectiveRegex(tokens: string[]): RegExp | null {
  if (!tokens.length) {
    return null;
  }

  const escaped = tokens.map(escapeRegExp).join("|");
  return new RegExp(`\\s*(?:${escaped})(?:\\s*:\\s*[A-Za-z0-9_-]+(?:\\s*,\\s*[A-Za-z0-9_-]+)*)?\\s*`, "gi");
}

function fullRange(document: vscode.TextDocument): vscode.Range {
  const start = new vscode.Position(0, 0);
  const end = document.lineAt(document.lineCount - 1).range.end;
  return new vscode.Range(start, end);
}

function buildIncludeGlob(fileExtensions: string[]): string {
  const cleaned = fileExtensions
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith(".") ? ext.slice(1) : ext));

  if (!cleaned.length) {
    return "**/*";
  }

  if (cleaned.length === 1) {
    return `**/*.${cleaned[0]}`;
  }

  return `**/*.{${cleaned.join(",")}}`;
}
