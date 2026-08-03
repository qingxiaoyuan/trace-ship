import * as vscode from "vscode";

/**
 * 单条冲突块信息
 */
interface ConflictBlock {
  /** <<<<<<< 所在行号（0-based） */
  startLine: number;
  /** ======= 所在行号（0-based） */
  separatorLine: number;
  /** >>>>>>> 所在行号（0-based） */
  endLine: number;
}

/** 冲突标记正则 */
const START_RE = /^<{7}[^<\n]*$/;
const SEPARATOR_RE = /^={7}$/;
const END_RE = /^>{7}[^>\n]*$/;

const CONFLICT_SCHEME = "commit-conflict";

/**
 * 解析文档中的 Git 冲突块
 *
 * @param document VS Code 文本文档
 * @returns 冲突块列表
 */
export function parseConflicts(document: vscode.TextDocument): ConflictBlock[] {
  const text = document.getText();
  if (text.indexOf("<<<<<<<") === -1) {
    return [];
  }

  const blocks: ConflictBlock[] = [];
  const lineCount = document.lineCount;
  let i = 0;

  while (i < lineCount) {
    const line = document.lineAt(i).text;
    if (!START_RE.test(line)) {
      i++;
      continue;
    }

    const startLine = i;
    let separatorLine = -1;
    let j = i + 1;

    // 查找 =======，若先遇到另一个 <<<<<<< 则当前块无效
    while (j < lineCount) {
      const cur = document.lineAt(j).text;
      if (START_RE.test(cur)) {
        break;
      }
      if (SEPARATOR_RE.test(cur)) {
        separatorLine = j;
        break;
      }
      j++;
    }

    if (separatorLine === -1) {
      // 未找到分隔符，跳到下一个起始标记或结束
      i = j < lineCount && START_RE.test(document.lineAt(j).text) ? j : lineCount;
      continue;
    }

    let endLine = -1;
    let k = separatorLine + 1;

    // 查找 >>>>>>>，若先遇到另一个 <<<<<<< 或 ======= 则当前块无效
    while (k < lineCount) {
      const cur = document.lineAt(k).text;
      if (START_RE.test(cur) || SEPARATOR_RE.test(cur)) {
        break;
      }
      if (END_RE.test(cur)) {
        endLine = k;
        break;
      }
      k++;
    }

    if (endLine === -1) {
      // 未找到结束标记，跳到下一个起始标记或结束
      i = k < lineCount && START_RE.test(document.lineAt(k).text) ? k : lineCount;
      continue;
    }

    blocks.push({ startLine, separatorLine, endLine });
    i = endLine + 1;
  }

  return blocks;
}

/**
 * 命令参数：定位冲突块
 */
interface ConflictLensArgs {
  uri: string;
  startLine: number;
}

/**
 * 根据 URI 和起始行号定位冲突块
 *
 * @param args 命令参数
 * @returns 冲突块与对应文档
 */
async function findBlock(
  args: ConflictLensArgs,
): Promise<{ document: vscode.TextDocument; block: ConflictBlock } | undefined> {
  const uri = vscode.Uri.parse(args.uri);
  const document = await vscode.workspace.openTextDocument(uri);
  return findBlockInDocument(document, args.startLine);
}

/**
 * 在指定文档中查找某一行所属的冲突块
 *
 * @param document 文档
 * @param line 行号（0-based）
 * @returns 冲突块与文档
 */
function findBlockInDocument(
  document: vscode.TextDocument,
  line: number,
): { document: vscode.TextDocument; block: ConflictBlock } | undefined {
  const blocks = parseConflicts(document);
  const block = blocks.find((b) => b.startLine <= line && b.endLine >= line);
  if (!block) {
    return undefined;
  }
  return { document, block };
}

/**
 * 解析命令参数；若未提供（如从命令面板调用），则尝试定位光标所在冲突块
 *
 * @param args 命令参数（可选）
 * @returns 解析后的参数与冲突块
 */
async function resolveConflictArgs(
  args?: ConflictLensArgs,
): Promise<{ document: vscode.TextDocument; block: ConflictBlock } | undefined> {
  if (args?.uri !== undefined) {
    return findBlock(args);
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  return findBlockInDocument(editor.document, editor.selection.active.line);
}

/**
 * 获取当前分支（ours）内容范围
 *
 * @param document 文档
 * @param block 冲突块
 * @returns 当前内容文本
 */
function getCurrentContent(document: vscode.TextDocument, block: ConflictBlock): string {
  if (block.startLine + 1 >= block.separatorLine) {
    return "";
  }
  return document.getText(
    new vscode.Range(block.startLine + 1, 0, block.separatorLine, 0),
  );
}

/**
 * 获取传入分支（theirs）内容范围
 *
 * @param document 文档
 * @param block 冲突块
 * @returns 传入内容文本
 */
function getIncomingContent(document: vscode.TextDocument, block: ConflictBlock): string {
  if (block.separatorLine + 1 >= block.endLine) {
    return "";
  }
  return document.getText(
    new vscode.Range(block.separatorLine + 1, 0, block.endLine, 0),
  );
}

/**
 * 获取完整冲突块范围（含标记行）
 *
 * @param document 文档
 * @param block 冲突块
 * @returns 范围
 */
function getBlockRange(document: vscode.TextDocument, block: ConflictBlock): vscode.Range {
  return new vscode.Range(
    block.startLine,
    0,
    block.endLine,
    document.lineAt(block.endLine).text.length,
  );
}

/**
 * 接受当前更改：保留 <<<<<<< 到 ======= 之间的内容
 */
async function acceptCurrentChange(args?: ConflictLensArgs): Promise<void> {
  const result = await resolveConflictArgs(args);
  if (!result) {
    return;
  }
  const { document, block } = result;
  const replacement = getCurrentContent(document, block);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, getBlockRange(document, block), replacement);
  await vscode.workspace.applyEdit(edit);
}

/**
 * 接受传入更改：保留 ======= 到 >>>>>>> 之间的内容
 */
async function acceptIncomingChange(args?: ConflictLensArgs): Promise<void> {
  const result = await resolveConflictArgs(args);
  if (!result) {
    return;
  }
  const { document, block } = result;
  const replacement = getIncomingContent(document, block);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, getBlockRange(document, block), replacement);
  await vscode.workspace.applyEdit(edit);
}

/**
 * 接受两个更改：合并两边内容
 */
async function acceptBothChanges(args?: ConflictLensArgs): Promise<void> {
  const result = await resolveConflictArgs(args);
  if (!result) {
    return;
  }
  const { document, block } = result;
  const current = getCurrentContent(document, block);
  const incoming = getIncomingContent(document, block);
  const replacement = current + incoming;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, getBlockRange(document, block), replacement);
  await vscode.workspace.applyEdit(edit);
}

/**
 * 比较变更：打开 diff 视图对比两边内容
 */
async function compareChange(args?: ConflictLensArgs): Promise<void> {
  const result = await resolveConflictArgs(args);
  if (!result) {
    return;
  }
  const { document, block } = result;
  const query = new URLSearchParams({
    uri: document.uri.toString(),
    startLine: String(block.startLine),
  });
  const currentUri = vscode.Uri.parse(`${CONFLICT_SCHEME}://current?${query.toString()}`);
  const incomingUri = vscode.Uri.parse(`${CONFLICT_SCHEME}://incoming?${query.toString()}`);
  await vscode.commands.executeCommand(
    "vscode.diff",
    currentUri,
    incomingUri,
    "比较变更",
    { preview: true },
  );
}

/**
 * 冲突内容虚拟文档提供器，用于 diff 视图
 */
class ConflictContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query);
    const sourceUri = query.get("uri");
    const startLine = parseInt(query.get("startLine") || "-1", 10);
    if (!sourceUri || Number.isNaN(startLine)) {
      return "";
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(sourceUri));
    const blocks = parseConflicts(document);
    const block = blocks.find((b) => b.startLine === startLine);
    if (!block) {
      return "";
    }

    const isCurrent = uri.authority === "current" || uri.path === "/current";
    return isCurrent
      ? getCurrentContent(document, block)
      : getIncomingContent(document, block);
  }
}

/**
 * CodeLens 提供器：在冲突标记处显示快捷操作按钮
 */
export class MergeConflictCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /**
   * 触发 CodeLens 刷新
   */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const blocks = parseConflicts(document);
    if (blocks.length === 0) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    for (const block of blocks) {
      const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
      const args: ConflictLensArgs = {
        uri: document.uri.toString(),
        startLine: block.startLine,
      };

      lenses.push(
        new vscode.CodeLens(range, {
          title: "接受当前更改",
          command: "commit.acceptCurrentChange",
          arguments: [args],
        }),
        new vscode.CodeLens(range, {
          title: "接受传入的更改",
          command: "commit.acceptIncomingChange",
          arguments: [args],
        }),
        new vscode.CodeLens(range, {
          title: "接受两个更改",
          command: "commit.acceptBothChanges",
          arguments: [args],
        }),
        new vscode.CodeLens(range, {
          title: "比较变更",
          command: "commit.compareChange",
          arguments: [args],
        }),
      );
    }

    return lenses;
  }
}

/**
 * 注册冲突解决相关命令与提供器
 *
 * @param context 扩展上下文
 */
export function registerConflictCommands(context: vscode.ExtensionContext): void {
  const provider = new ConflictContentProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(CONFLICT_SCHEME, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("commit.acceptCurrentChange", acceptCurrentChange),
    vscode.commands.registerCommand("commit.acceptIncomingChange", acceptIncomingChange),
    vscode.commands.registerCommand("commit.acceptBothChanges", acceptBothChanges),
    vscode.commands.registerCommand("commit.compareChange", compareChange),
  );
}
