import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { autoCorrectCommit, validateCommit } from "./commitValidator";

const execAsync = promisify(exec);

/**
 * Git 文件状态类型（使用数值，对应 VS Code 内置 Git 扩展的 Status 枚举）
 * 注意：不同 VS Code 版本中 Status 枚举的顺序可能不同，因此业务代码中应通过
 * gitApi.Status 动态获取，避免硬编码值导致状态识别错误。
 */
type GitStatus = number;

/**
 * 老版本 VS Code 中 Git Status 枚举的兜底映射（当 gitApi.Status 不可用时使用）
 */
const LegacyGitStatus = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  IGNORED: 8,
  INTENT_TO_ADD: 9,
  INTENT_TO_RENAME: 10,
};

interface GitChange {
  status: GitStatus;
  originalUri: vscode.Uri;
  uri: vscode.Uri;
  renameUri?: vscode.Uri;
}

interface RepoChange {
  status: GitStatus;
  statusLetter: string;
  statusColor: string;
  filename: string;
  dir: string;
  fullPath: string;
  isStaged: boolean;
  isImage: boolean; // 是否为图片文件，用于在列表中显示图片图标
  originalFullPath?: string; // 重命名文件的原路径，打开 diff 时需要
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _currentCommit: string = "";
  private _disposables: vscode.Disposable[] = [];
  private _refreshing: boolean = false; // 重入保护：标记是否正在刷新
  private _pendingRefresh: boolean = false; // 刷新期间又有新变化，则结束后再补一次
  private _firstLoad: boolean = true; // 仅首次显示 loading 骨架，避免后续刷新闪烁
  private _debounceTimer: any = null; // 状态变化去抖定时器
  private _statusEnum?: any; // 缓存运行时 Git Status 枚举

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  /**
   * 获取 VS Code 内置 Git 扩展的 Status 枚举。
   * 不同 VS Code 版本中枚举值的顺序可能不同，优先使用运行时对象，避免硬编码。
   */
  private _getStatusEnum(gitApi: any): any {
    if (this._statusEnum) {
      return this._statusEnum;
    }
    if (gitApi?.Status) {
      this._statusEnum = gitApi.Status;
      return this._statusEnum;
    }
    this._statusEnum = LegacyGitStatus;
    return this._statusEnum;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtmlForWebview();

    this._disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this._refreshChanges();
        }
      }),
    );

    this._disposables.push(
      webviewView.onDidDispose(() => {
        this._view = undefined;
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
      }),
    );

    this._disposables.push(
      webviewView.webview.onDidReceiveMessage(async (message) => {
        try {
          switch (message.command) {
            case "generateCommit":
              await this.generateCommit();
              break;
            case "copyCommit":
              await this.copyCommit(message.commit);
              break;
            case "refreshDiff":
              await this.refreshDiff();
              break;
            case "openSettings":
              await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "commit",
              );
              break;
            case "openFile":
              await this.openFileInDiffView(
                message.filepath,
                message.status,
                message.originalFilepath,
              );
              break;
            case "stageFile":
              await this.stageFile(message.filepath);
              break;
            case "stageAll":
              await this.stageAll();
              break;
            case "unstageFile":
              await this.unstageFile(message.filepath);
              break;
            case "unstageAll":
              await this.unstageAll();
              break;
            case "discardFile":
              await this.discardFile(message.filepath, message.status);
              break;
            case "commit":
              await this.commit(message.message, message.mode);
              break;
            case "insertTemplate":
              this._insertTemplate();
              break;
          }
        } catch (err: any) {
          this._view?.webview.postMessage({
            command: "error",
            error: err?.message || String(err),
          });
        }
      }),
    );

    this._watchGitStatus();
    this._refreshChanges();
  }

  /**
   * 监听 Git 状态变化，自动刷新 Changes 列表
   */
  private _watchGitStatus() {
    try {
      const ext = vscode.extensions.getExtension("vscode.git");
      const apiOrThenable = ext
        ? ext.activate().then(() => ext.exports.getAPI(1))
        : Promise.resolve(null);

      Promise.resolve(apiOrThenable)
        .then((gitApi: any) => {
          if (!gitApi) {
            return;
          }
          if (typeof gitApi.onDidOpenRepository === "function") {
            this._disposables.push(
              gitApi.onDidOpenRepository((repo: any) => this._bindRepo(repo)),
            );
          }
          if (typeof gitApi.onDidCloseRepository === "function") {
            this._disposables.push(
              gitApi.onDidCloseRepository(() => this._scheduleRefresh()),
            );
          }
          (gitApi.repositories || []).forEach((repo: any) =>
            this._bindRepo(repo),
          );
        })
        .catch((err: any) => {
          console.warn("[SidebarProvider] 监听 Git 状态失败:", err);
        });
    } catch (err: any) {
      console.warn("[SidebarProvider] _watchGitStatus 异常:", err);
    }
  }

  private _bindRepo(repo: any) {
    try {
      if (
        !repo ||
        !repo.state ||
        typeof repo.state.onDidChange !== "function"
      ) {
        return;
      }
      // 状态变化去抖：Git 一次操作可能触发多次 onDidChange，合并为一次刷新
      this._disposables.push(
        repo.state.onDidChange(() => this._scheduleRefresh()),
      );
    } catch (err: any) {
      console.warn("[SidebarProvider] _bindRepo 失败:", err);
    }
  }

  /**
   * 去抖调度刷新：300ms 内多次状态变化只触发一次 _refreshChanges
   */
  private _scheduleRefresh() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._refreshChanges();
    }, 300);
  }

  /**
   * 刷新 Changes 列表到 Webview
   */
  private async _refreshChanges() {
    if (!this._view) {
      return;
    }

    // 重入保护：上一次刷新未完成时，标记待补，不再并发执行
    if (this._refreshing) {
      this._pendingRefresh = true;
      return;
    }
    this._refreshing = true;

    try {
      // 仅首次加载显示 loading 骨架，后续静默刷新，避免列表闪烁/抖动
      if (this._firstLoad) {
        this._view.webview.postMessage({
          command: "diffStats",
          changes: [],
          files: 0,
          additions: 0,
          deletions: 0,
          loading: true,
        });
      }

      const gitApi = await this._getGitApi();
      const repos: any[] = gitApi.repositories || [];
      if (repos.length === 0) {
        this._view.webview.postMessage({
          command: "diffStats",
          changes: [],
          files: 0,
          additions: 0,
          deletions: 0,
        });
        return;
      }

      await Promise.all(repos.map((r) => this._waitRepoStateReady(r)));

      const changes = this._collectChanges(gitApi);
      const stats = await this._calcStatsFromRepo();

      this._view.webview.postMessage({
        command: "diffStats",
        additions: stats.additions,
        deletions: stats.deletions,
        files: changes.staged.length + changes.unstaged.length,
        changes,
      });
    } catch (err: any) {
      this._view.webview.postMessage({
        command: "error",
        error: err.message || "刷新失败",
      });
    } finally {
      this._refreshing = false;
      this._firstLoad = false;
      // 刷新期间又来过状态变化，则补一次；否则结束
      if (this._pendingRefresh) {
        this._pendingRefresh = false;
        this._scheduleRefresh();
      }
    }
  }

  private async _getGitApi(): Promise<any> {
    const ext = vscode.extensions.getExtension("vscode.git");
    if (!ext) {
      throw new Error("Git 扩展未启用");
    }
    if (!ext.isActive) {
      await ext.activate();
    }
    return ext.exports.getAPI(1);
  }

  /**
   * 等待仓库 state 就绪：只读取当前 state，不主动调用 repo.status()（避免触发 onDidChange 自激）
   * 给 state 一小段时间稳定后即返回；onDidChange 已由 _bindRepo 统一去抖调度刷新
   */
  private _waitRepoStateReady(repo: any): Promise<void> {
    return new Promise((resolve) => {
      // state 已存在即直接返回，让 _collectChanges 读取当前快照
      if (repo.state && Array.isArray(repo.state.workingTreeChanges)) {
        resolve();
        return;
      }
      // 极少数情况下 state 尚未初始化，短轮询等待
      const poll = setInterval(() => {
        if (repo.state && Array.isArray(repo.state.workingTreeChanges)) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 80);
      const timer = setTimeout(() => {
        clearInterval(poll);
        resolve();
      }, 800);
    });
  }

  private _collectChanges(gitApi: any): {
    staged: RepoChange[];
    unstaged: RepoChange[];
  } {
    const repos: any[] = gitApi.repositories || [];
    const staged: RepoChange[] = [];
    const unstaged: RepoChange[] = [];
    const Status = this._getStatusEnum(gitApi);

    const map = (
      change: GitChange,
      repoRoot: string,
      isStaged: boolean,
    ): RepoChange => {
      const fullPath = change.uri.fsPath;
      const rel = path.relative(repoRoot, fullPath);
      const filename = path.basename(rel);
      const dir = path.dirname(rel) === "." ? "" : path.dirname(rel);
      return {
        status: change.status,
        statusLetter: this._statusToLetter(change.status, Status),
        statusColor: this._statusToColor(change.status, Status),
        filename,
        dir,
        fullPath,
        isStaged,
        isImage: this._isPreviewableImageFile(filename),
        originalFullPath: change.originalUri?.fsPath,
      };
    };

    for (const repo of repos) {
      const rootPath = repo.rootUri.fsPath;
      (repo.state.indexChanges || []).forEach((c: GitChange) =>
        staged.push(map(c, rootPath, true)),
      );
      (repo.state.workingTreeChanges || []).forEach((c: GitChange) =>
        unstaged.push(map(c, rootPath, false)),
      );
    }

    staged.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    unstaged.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    return { staged, unstaged };
  }

  private _statusToLetter(status: GitStatus, Status: any): string {
    switch (status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
        return "M";
      case Status.INDEX_ADDED:
        return "A";
      case Status.ADDED:
      case Status.UNTRACKED:
      case Status.INTENT_TO_ADD:
        return "U";
      case Status.INDEX_DELETED:
      case Status.DELETED:
        return "D";
      case Status.INDEX_RENAMED:
      case Status.RENAMED:
      case Status.INTENT_TO_RENAME:
        return "R";
      case Status.INDEX_COPIED:
      case Status.COPIED:
        return "C";
      case Status.UNMERGED:
        return "!";
      case Status.IGNORED:
        return "I";
      default:
        return "?";
    }
  }

  private _statusToColor(status: GitStatus, Status: any): string {
    switch (status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
      case Status.INDEX_RENAMED:
      case Status.RENAMED:
      case Status.INTENT_TO_RENAME:
        return "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)";
      case Status.INDEX_ADDED:
      case Status.ADDED:
      case Status.INDEX_COPIED:
      case Status.COPIED:
      case Status.UNTRACKED:
      case Status.INTENT_TO_ADD:
        return "var(--vscode-gitDecoration-addedResourceForeground, #81b88b)";
      case Status.INDEX_DELETED:
      case Status.DELETED:
        return "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)";
      case Status.UNMERGED:
        return "var(--vscode-gitDecoration-conflictingResourceForeground, #e2a05c)";
      case Status.IGNORED:
        return "var(--vscode-gitDecoration-ignoredResourceForeground, #8c8c8c)";
      default:
        return "var(--vscode-foreground)";
    }
  }

  private async _calcStatsFromRepo(): Promise<{
    additions: number;
    deletions: number;
  }> {
    try {
      const gitApi = await this._getGitApi();
      const repo = gitApi.repositories?.[0];
      if (!repo) {
        return { additions: 0, deletions: 0 };
      }

      // 复用 _getRepoDiff：含未跟踪文件，统计更准确
      const diffContent = await this._getRepoDiff(repo);
      return this._parseDiffStats(diffContent);
    } catch {
      return { additions: 0, deletions: 0 };
    }
  }

  private _parseDiffStats(diffContent: string): {
    additions: number;
    deletions: number;
  } {
    const lines = diffContent.split("\n");
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
    return { additions, deletions };
  }

  /**
   * 获取仓库完整 diff（含未跟踪文件内容），供 AI 生成使用
   * vscode.git 的 repo.diff() 仅返回已跟踪文件的改动，不含未跟踪(新建)文件内容，
   * 新建库/纯新增文件场景下会返回空。这里改用 git CLI：
   *   - HEAD 与工作区之间的已跟踪改动
   *   - 暂存区与工作区之间的改动
   *   - 未跟踪文件的完整内容（以 diff 形式呈现）
   */
  private async _getRepoDiff(repo: any): Promise<string> {
    const root: string = repo.rootUri.fsPath;
    const parts: string[] = [];

    // 1) 已跟踪文件：工作区 vs HEAD（含暂存区）
    try {
      const head = await execAsync(
        `git -C "${root}" --no-pager diff HEAD --no-color --no-ext-diff`,
        { maxBuffer: 20 * 1024 * 1024 },
      );
      if (head.stdout.trim()) {
        parts.push(head.stdout);
      }
    } catch (e: any) {
      // 无 HEAD（空仓库）时 git diff HEAD 会失败，忽略，走未跟踪分支
    }

    // 2) 未跟踪文件内容：git ls-files --others --exclude-standard -z 列出，逐个构造 diff
    try {
      const untracked = await execAsync(
        `git -C "${root}" ls-files --others --exclude-standard -z`,
        { maxBuffer: 20 * 1024 * 1024 },
      );
      const files = untracked.stdout
        .split("\0")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const rel of files) {
        const abs = path.join(root, rel);

        // 图片/二进制文件不进入 AI prompt，仅记录文件名即可
        if (this._isImageFile(path.basename(rel))) {
          parts.push(
            `diff --git a/${rel} b/${rel}\n` +
              `new file mode 100644\n` +
              `--- /dev/null\n` +
              `+++ b/${rel}\n` +
              `+Binary file (image/binary) added`,
          );
          continue;
        }

        let content = "";
        try {
          content = fs.readFileSync(abs, "utf8");
        } catch {
          continue; // 二进制或读取失败则跳过
        }
        // 截断过长文件，避免单文件撑爆 prompt
        const capped =
          content.length > 8000
            ? content.slice(0, 8000) + "\n... (截断)"
            : content;
        parts.push(
          `diff --git a/${rel} b/${rel}\n` +
            `new file mode 100644\n` +
            `--- /dev/null\n` +
            `+++ b/${rel}\n` +
            capped
              .split("\n")
              .map((line) => `+${line}`)
              .join("\n"),
        );
      }
    } catch (e: any) {
      console.warn("[SidebarProvider] 列举未跟踪文件失败:", e);
    }

    // 3) 兜底：若 CLI 全空（极少见，如权限问题），回退到 Git 扩展 API
    if (parts.length === 0) {
      try {
        let diff = await repo.diff();
        if (!diff.trim()) {
          diff = await repo.diff(true);
        }
        return diff || "";
      } catch {
        return "";
      }
    }

    return parts.join("\n");
  }

  /**
   * 获取仓库暂存区 diff（git diff --cached / git diff --staged），仅含已暂存改动
   */
  private async _getStagedDiff(repo: any): Promise<string> {
    const root: string = repo.rootUri.fsPath;
    try {
      const cached = await execAsync(
        `git -C "${root}" --no-pager diff --cached --no-color --no-ext-diff`,
        { maxBuffer: 20 * 1024 * 1024 },
      );
      return cached.stdout || "";
    } catch {
      return "";
    }
  }

  /**
   * 常见图片/二进制扩展名列表；这些文件不进入 AI prompt。
   */
  private _isImageFile(filename: string): boolean {
    const imageExts = new Set([
      "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "svg",
      "tiff", "tif", "raw", "cr2", "nef", "heic", "heif",
      "psd", "ai", "eps", "sketch", "fig", "xd",
      "mp3", "mp4", "avi", "mov", "wmv", "flv", "mkv",
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
      "zip", "rar", "7z", "tar", "gz", "bz2",
      "exe", "dll", "so", "dylib", "bin", "dat",
    ]);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return imageExts.has(ext);
  }

  /**
   * VS Code 内置图片预览编辑器支持的常见图片类型。
   */
  private _isPreviewableImageFile(filename: string): boolean {
    const imageExts = new Set([
      "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "svg",
      "tiff", "tif",
    ]);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return imageExts.has(ext);
  }

  /**
   * 判断一个 diff 块是否属于二进制文件。
   * git 对二进制文件输出形如 "Binary files /dev/null and b/x.png differ"，
   * 文件路径夹在 "Binary files" 与 "differ" 之间，因此用 .* 跨越路径匹配。
   */
  private _isBinaryDiffBlock(diffBlock: string): boolean {
    return /Binary files.*differ|GIT binary patch/i.test(diffBlock);
  }

  /**
   * 从 diff 块中提取文件名（优先取 +++ b/<path>，删除文件回退到 --- a/<path>）。
   * 用于按扩展名跳过图片等不希望进入 AI prompt 的文件。
   */
  private _extractFilenameFromDiffBlock(diffBlock: string): string | undefined {
    const m =
      diffBlock.match(/^\+\+\+ b\/(.+)$/m) ||
      diffBlock.match(/^--- a\/(.+)$/m);
    if (!m) {
      return undefined;
    }
    const p = m[1].trim().replace(/^"|"$/g, "");
    return path.basename(p);
  }

  private async openFileInDiffView(
    filepath: string,
    status: GitStatus,
    originalFilepath?: string,
  ) {
    const uri = vscode.Uri.file(filepath);
    const filename = path.basename(filepath);

    const gitApi = await this._getGitApi().catch(() => null);
    if (!gitApi) {
      vscode.window.showErrorMessage("Git 扩展未启用，无法打开 diff");
      return;
    }

    // 找到文件所属的仓库（多仓库场景下不能只用 repositories[0]）
    const repo = (gitApi.repositories || []).find((r: any) => {
      const root = r.rootUri?.fsPath || "";
      return filepath === root || filepath.startsWith(root + path.sep);
    });
    if (!repo) {
      vscode.window.showErrorMessage("未找到文件所属的 Git 仓库");
      return;
    }

    const Status = this._getStatusEnum(gitApi);
    const rootPath = repo.rootUri.fsPath;

    // 优先使用 VS Code 内置 Git 扩展的 toGitUri 构造 git scheme URI，兼容性和准确性更好
    const makeGitUri = (targetUri: vscode.Uri, ref: string): vscode.Uri =>
      typeof gitApi.toGitUri === "function"
        ? gitApi.toGitUri(targetUri, ref)
        : targetUri.with({
            scheme: "git",
            query: JSON.stringify({ path: targetUri.fsPath, ref }),
          });

    /**
     * 尝试打开 diff 视图；若 Git 历史版本不存在（如新文件、被忽略文件等），
     * 则静默退化为直接打开工作区版本，避免弹窗报错。
     */
    const tryOpenDiff = async (
      leftUri: vscode.Uri,
      rightUri: vscode.Uri,
      title: string,
    ) => {
      try {
        // 解析 git URI query 中的绝对路径，计算相对仓库根目录的路径
        const query = JSON.parse(leftUri.query || "{}");
        const absPath = query.path || leftUri.fsPath;
        const relPath = path.relative(rootPath, absPath).replace(/\\/g, "/");
        if (relPath) {
          // 先用 git cat-file 检查该文件在指定 ref 中是否存在
          const escaped = relPath.replace(/"/g, '\\"');
          await execAsync(`git -C "${rootPath}" cat-file -e HEAD:"${escaped}"`, {
            maxBuffer: 10 * 1024 * 1024,
          });
        }
        await vscode.commands.executeCommand(
          "vscode.diff",
          leftUri,
          rightUri,
          title,
          { preview: true },
        );
      } catch {
        // 直接打开工作区版本；使用 vscode.open 命令可兼容文本与二进制文件（如图片）
        await vscode.commands.executeCommand("vscode.open", rightUri, {
          preview: true,
        });
      }
    };

    /**
     * 尝试打开单个 Git URI（用于已删除文件打开 HEAD 版本）；
     * 若 HEAD 中不存在，则显示提示信息。
     */
    const tryOpenGitFile = async (
      gitUri: vscode.Uri,
      notFoundMessage: string,
    ) => {
      try {
        const query = JSON.parse(gitUri.query || "{}");
        const absPath = query.path || gitUri.fsPath;
        const relPath = path
          .relative(rootPath, absPath)
          .replace(/\\/g, "/");
        if (relPath) {
          const escaped = relPath.replace(/"/g, '\\"');
          await execAsync(`git -C "${rootPath}" cat-file -e HEAD:"${escaped}"`, {
            maxBuffer: 10 * 1024 * 1024,
          });
        }
        await vscode.commands.executeCommand("vscode.open", gitUri, {
          preview: true,
        });
      } catch {
        vscode.window.showInformationMessage(notFoundMessage);
      }
    };

    try {
      // 未跟踪 / 已暂存新增 / 被忽略 / intent-to-add 文件：直接打开工作区版本
      if (
        status === Status.ADDED ||
        status === Status.INDEX_ADDED ||
        status === Status.INDEX_COPIED ||
        status === Status.COPIED ||
        status === Status.UNTRACKED ||
        status === Status.IGNORED ||
        status === Status.INTENT_TO_ADD
      ) {
        await vscode.commands.executeCommand("vscode.open", uri, {
          preview: true,
        });
        return;
      }

      // 已删除文件：打开 HEAD 版本；若 HEAD 中不存在则给出提示
      if (status === Status.DELETED || status === Status.INDEX_DELETED) {
        await tryOpenGitFile(
          makeGitUri(uri, "HEAD"),
          "该文件在 Git 历史版本中不存在，无法预览删除前的内容",
        );
        return;
      }

      // 重命名文件：左侧用原文件路径的 HEAD 版本，右侧用新文件路径的工作区版本
      if (
        status === Status.RENAMED ||
        status === Status.INDEX_RENAMED ||
        status === Status.INTENT_TO_RENAME
      ) {
        const oldPath = originalFilepath || filepath;
        const oldUri = vscode.Uri.file(oldPath);
        const title = `${filename} (Renamed)`;
        await tryOpenDiff(makeGitUri(oldUri, "HEAD"), uri, title);
        return;
      }

      // 默认：已修改文件打开 diff 视图（文本文件）
      const title = `${filename} (Working Tree)`;
      await tryOpenDiff(makeGitUri(uri, "HEAD"), uri, title);
    } catch (err: any) {
      console.error("[openFileInDiffView] 打开文件失败:", err);
      const rawMessage = err?.message || "";
      const isBinaryTextError = /binary|cannot be opened as text/i.test(rawMessage);
      const hint = isBinaryTextError
        ? `VS Code 把 ${filename} 当作文本文件打开失败。请检查：1) 该文件是否真的是有效图片；2) settings.json 中 workbench.editorAssociations 是否把 *.png 绑定到了文本编辑器。`
        : rawMessage || `无法打开文件 ${filename}`;
      vscode.window.showErrorMessage(`[Commit] ${hint}`);
    }
  }

  private async stageFile(filepath: string) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi?.repositories?.[0];
    if (!repo) {
      return;
    }
    await repo.add([filepath]);
    await this._refreshChanges();
  }

  /**
   * 暂存所有未暂存文件
   */
  private async stageAll() {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi?.repositories?.[0];
    if (!repo) {
      return;
    }
    const Status = this._getStatusEnum(gitApi);
    const paths = (repo.state.workingTreeChanges || [])
      .filter((c: GitChange) => c.status !== Status.UNMERGED)
      .map((c: GitChange) => c.uri.fsPath);
    if (paths.length === 0) {
      return;
    }
    await repo.add(paths);
    await this._refreshChanges();
  }

  private async unstageFile(filepath: string) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi?.repositories?.[0];
    if (!repo) {
      return;
    }
    const root = repo.rootUri.fsPath;
    const rel = path.relative(root, filepath).replace(/\\/g, "/");
    await execAsync(`git -C "${root}" reset HEAD -- "${rel}"`);
    await repo.status();
    await this._refreshChanges();
  }

  /**
   * 取消暂存所有已暂存文件
   */
  private async unstageAll() {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi?.repositories?.[0];
    if (!repo) {
      return;
    }
    const root = repo.rootUri.fsPath;
    await execAsync(`git -C "${root}" reset HEAD -- .`);
    await repo.status();
    await this._refreshChanges();
  }

  private async discardFile(filepath: string, status: GitStatus) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi?.repositories?.[0];
    if (!repo) {
      return;
    }

    const Status = this._getStatusEnum(gitApi);
    const filename = path.basename(filepath);
    const answer = await vscode.window.showWarningMessage(
      `确定要放弃对 "${filename}" 的更改吗？`,
      { modal: true },
      "放弃更改",
    );
    if (answer !== "放弃更改") {
      return;
    }

    if (status === Status.ADDED || status === Status.UNTRACKED) {
      await vscode.workspace.fs.delete(vscode.Uri.file(filepath));
    } else {
      await repo.revert([filepath]);
    }
    await this._refreshChanges();
  }

  private async commit(message: string, mode: "commit" | "push" | "sync") {
    if (!message.trim()) {
      this._view?.webview.postMessage({
        command: "error",
        error: "请输入提交信息",
      });
      return;
    }

    let gitApi: any;
    try {
      gitApi = await this._getGitApi();
    } catch (err: any) {
      this._view?.webview.postMessage({
        command: "error",
        error: err?.message || "Git 扩展未启用",
      });
      return;
    }
    const repo = gitApi.repositories[0];
    if (!repo) {
      this._view?.webview.postMessage({
        command: "error",
        error: "未找到 Git 仓库",
      });
      return;
    }

    try {
      try {
        await repo.status();
      } catch {}

      const hasStaged = (repo.state.indexChanges?.length ?? 0) > 0;
      if (!hasStaged) {
        const paths = (repo.state.workingTreeChanges || []).map(
          (c: GitChange) => c.uri.fsPath,
        );
        if (paths.length === 0) {
          this._view?.webview.postMessage({
            command: "error",
            error: "没有可提交的变更",
          });
          return;
        }
        await repo.add(paths);
      }

      await repo.commit(message);
      this._view?.webview.postMessage({
        command: "status",
        message: "提交成功",
        type: "success",
      });

      if (mode === "push") {
        await repo.push();
        this._view?.webview.postMessage({
          command: "status",
          message: "已提交并推送",
          type: "success",
        });
      } else if (mode === "sync") {
        await repo.pull();
        await repo.push();
        this._view?.webview.postMessage({
          command: "status",
          message: "已同步",
          type: "success",
        });
      }

      await this._refreshChanges();
      this._view?.webview.postMessage({ command: "clearMessage" });
    } catch (err: any) {
      this._view?.webview.postMessage({
        command: "error",
        error: err.message || "提交失败",
      });
    }
  }

  /**
   * 生成 AI commit 信息并填入 Message 输入框
   */
  public async generateCommit() {
    if (!this._view) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration("commit");
    const apiEndpoint = cfg.get("apiEndpoint") as string;
    const apiKey = cfg.get("apiKey") as string;
    const model = cfg.get("model") as string;

    if (!apiKey) {
      this._view.webview.postMessage({
        command: "error",
        error: "请先在设置中配置 AI API 密钥",
      });
      return;
    }

    try {
      const gitApi = await this._getGitApi();
      const repos: any[] = gitApi.repositories || [];
      if (repos.length === 0) {
        throw new Error("未找到 Git 仓库");
      }

      await Promise.all(repos.map((r: any) => this._waitRepoStateReady(r)));

      // 校验：必须至少有一个仓库的暂存区有内容
      const stagedCount = repos.reduce(
        (sum, repo) => sum + (repo.state?.indexChanges?.length || 0),
        0,
      );
      if (stagedCount === 0) {
        this._view.webview.postMessage({
          command: "error",
          error: "暂存区没有内容，请先将变更添加到暂存区",
        });
        this._view.webview.postMessage({ command: "generatingDone" });
        return;
      }

      // 收集每个仓库的 diff：仅基于暂存区（git diff --cached），不含未跟踪文件
      const diffs: string[] = [];
      for (const repo of repos) {
        const diff = await this._getStagedDiff(repo);
        if (diff.trim()) {
          diffs.push(diff);
        }
      }
      const diffToUse = diffs.join("\n");

      if (!diffToUse.trim()) {
        this._view.webview.postMessage({
          command: "error",
          error: "暂存区没有内容，请先将变更添加到暂存区",
        });
        this._view.webview.postMessage({ command: "generatingDone" });
        return;
      }

      const stats = this._parseDiffStats(diffToUse);
      const changes = this._collectChanges(gitApi);

      this._view.webview.postMessage({
        command: "diffStats",
        additions: stats.additions,
        deletions: stats.deletions,
        files: changes.staged.length + changes.unstaged.length,
        changes,
      });

      // 两阶段生成：先按文件生成一句话摘要，再汇总提炼最终 commit，避免单 prompt 过长
      // 过滤掉二进制文件和图片（图片不进入 AI prompt，仅由文件名参与统计）
      const fileDiffs = this._splitDiffByFile(diffToUse).filter((d) => {
        if (this._isBinaryDiffBlock(d)) {
          return false;
        }
        const name = this._extractFilenameFromDiffBlock(d);
        return !name || !this._isImageFile(name);
      });
      const summaries: string[] = [];
      for (const fileDiff of fileDiffs) {
        if (!fileDiff.trim()) {
          continue;
        }
        const prompt = this._buildFileSummaryPrompt(fileDiff);
        const text = await this._callAi(apiEndpoint, apiKey, model, prompt);
        if (text) {
          summaries.push(text);
        }
      }

      if (summaries.length === 0) {
        throw new Error("AI 未返回有效 commit 条目");
      }

      // 第二阶段：汇总所有文件摘要，提炼主题后生成最终 commit
      const finalPrompt = this._buildFinalPrompt(summaries);
      const commitText = await this._callAi(
        apiEndpoint,
        apiKey,
        model,
        finalPrompt,
      );

      if (!commitText) {
        throw new Error(`AI 返回内容为空，请检查 API 端点/模型/密钥配置`);
      }

      // 自动校正并校验最终 commit 信息，防止 AI 输出跑偏
      const { corrected, ok, errors, warnings } = validateCommit(commitText);
      const finalCommit = corrected;
      this._currentCommit = finalCommit;

      this._view.webview.postMessage({
        command: "commitGenerated",
        commit: finalCommit,
      });

      if (!ok) {
        this._view.webview.postMessage({
          command: "error",
          error: `提交信息已自动校正，但仍存在不符合规范的问题：${errors.join(
            "；",
          )}。请手动修改后再提交。`,
        });
      } else if (warnings.length > 0) {
        this._view.webview.postMessage({
          command: "status",
          message: `已生成，但存在以下建议修改：${warnings.join("；")}`,
          type: "info",
        });
      }
    } catch (error: any) {
      this._view.webview.postMessage({
        command: "error",
        error: error.message || "生成失败",
      });
    } finally {
      this._view.webview.postMessage({ command: "generatingDone" });
    }
  }

  /**
   * 调用 AI 接口，返回清洗后的文本
   */
  private async _callAi(
    apiEndpoint: string,
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const isAnthropic = /\/anthropic/i.test(apiEndpoint);
    const url = isAnthropic
      ? this._buildAnthropicUrl(apiEndpoint)
      : this._buildOpenAiUrl(apiEndpoint);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (isAnthropic) {
      headers["anthropic-version"] = "2023-06-01";
    }
    const body: any = isAnthropic
      ? {
          model,
          max_tokens: 512,
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
        }
      : {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          stream: false,
        };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `API 请求失败: ${response.status} ${errText.slice(0, 200)}`,
      );
    }

    const rawText = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`AI 返回不是合法 JSON: ${rawText.slice(0, 200)}`);
    }

    const text: string =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      data?.choices?.[0]?.delta?.content?.trim() ||
      data?.content?.find?.((b: any) => b?.type === "text")?.text?.trim() ||
      data?.content?.trim?.() ||
      data?.message?.content?.trim() ||
      data?.text?.trim() ||
      data?.output?.trim() ||
      "";

    return autoCorrectCommit(text);
  }

  /**
   * 按文件拆分 diff（以 "diff --git" 为界）
   */
  private _splitDiffByFile(diff: string): string[] {
    const files: string[] = [];
    let current: string[] = [];
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git")) {
        if (current.length > 0) {
          files.push(current.join("\n"));
        }
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) {
      files.push(current.join("\n"));
    }
    return files;
  }

  /**
   * 合并多个文件的 commit 条目，去重并精炼
   */
  private _mergeCommitItems(items: string[]): string {
    // 收集所有非空条目行
    const lines: string[] = [];
    for (const item of items) {
      for (const line of item.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        // 跳过标题行和引导行
        if (/^(更新内容|单行提交|复杂提交|\[A为功能增加|或$)/.test(trimmed)) {
          continue;
        }
        lines.push(trimmed);
      }
    }

    // 简单去重：完全相同的行只保留一次
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const line of lines) {
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      unique.push(line);
    }

    // 如果全是单行条目且内容相同，合并为一条；否则返回多行
    const featFixLines = unique.filter((l) =>
      /^(<feat>|<fix>|\d+\.\s*[AF])/.test(l),
    );
    if (featFixLines.length === 0) {
      return unique.join("\n");
    }

    // 若条目数过多，只保留有价值的（去重后最多 8 条）
    return featFixLines.slice(0, 8).join("\n");
  }

  /**
   * 构造 OpenAI Chat Completions URL，兼容常见填法：
   *   - https://api.minimaxi.com
   *   - https://api.minimaxi.com/v1
   *   - https://api.minimaxi.com/v1/chat/completions
   */
  private _buildOpenAiUrl(apiEndpoint: string): string {
    const base = apiEndpoint.replace(/\/+$/, "");
    if (/\/v1\/chat\/completions$/.test(base)) {
      return base;
    }
    if (/\/chat\/completions$/.test(base)) {
      return base;
    }
    if (/\/v1$/.test(base)) {
      return `${base}/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
  }

  /**
   * 构造 Anthropic Messages URL，兼容常见填法：
   *   - https://api.minimaxi.com/anthropic
   *   - https://api.minimaxi.com/anthropic/v1/messages
   */
  private _buildAnthropicUrl(apiEndpoint: string): string {
    const base = apiEndpoint.replace(/\/+$/, "");
    if (/\/v1\/messages$/.test(base)) {
      return base;
    }
    if (/\/v1$/.test(base)) {
      return `${base}/messages`;
    }
    return `${base}/v1/messages`;
  }

  /**
   * 第一阶段 prompt：根据单个文件 diff，输出一句话摘要（含 A/F 类型）
   */
  private _buildFileSummaryPrompt(fileDiff: string): string {
    return `你是一个代码审查助手。请根据以下单个文件的 git diff，用一句话概括这个文件改动的用户价值或主题。

## 输出格式（严格只输出一行）：
<feat> A 一句话描述新增功能
或
<fix> F 一句话描述修复的BUG

## 生成规则（严禁违反）：
1. 只输出一行，禁止输出标题、思考过程、解释、序号、代码块。
2. 必须保留 A 或 F 字母标识：新增功能用 "<feat> A ..."，BUG 修复用 "<fix> F ..."。
3. 根据 diff 判断是新增功能(A)还是 BUG 修复(F)。
4. 描述必须简洁、具体、面向用户价值，不写 "优化"、"调整"、"修改" 等模糊词。
5. 直接输出结果，不要分析、不要推理、不要总结。

## Git Diff 内容：
${fileDiff}

请直接输出一行摘要。`;
  }

  /**
   * 第二阶段 prompt：汇总所有文件摘要，提炼主题后生成最终 commit
   */
  private _buildFinalPrompt(summaries: string[]): string {
    const joined = summaries
      .map((s, i) => `${i + 1}. ${s.replace(/^[\s\-]+/, "")}`)
      .join("\n");

    return `你是一个专业的代码提交助手。以下是本次提交涉及的所有文件摘要，请直接生成最终 commit 信息。

## 文件摘要：
${joined}

## 输出格式（只输出以下内容，不要标题）：

情况一：所有摘要属于同一主题，并且只有 A 或只有 F 时，使用单行提交：
<feat> A 一句话描述新增功能
或
<fix> F 一句话描述修复的BUG

情况二：同时存在 A 和 F，或存在多个不同主题时，使用复杂提交。整体只输出一个标题行，标题按主要主题选择 <feat> 或 <fix>；标题下方用从 1 开始的连续编号列出条目：
<feat> 一句话概括本次提交主题

1. A 具体功能描述
2. F 具体修复描述
3. A 具体功能描述
4. A/F ...（按实际内容连续编号到末尾，序号不得重置）

## 生成规则（严禁违反）：
1. 直接输出最终 commit 内容，禁止先写 "思考"、"分析"、"推理"、"总结" 等任何说明。
2. 复杂提交必须且只能输出一个标题行（<feat> 或 <fix>），严禁出现两个或以上 <feat>/<fix> 标题；严禁按 A/F 分组各起一个标题块。
3. 标题行下方为单一序号列表，序号从 1 开始连续递增到末尾，禁止中途重置、跳号或分组重新计数。
4. 相同或相关的摘要要合并成一条，不要简单把每个文件摘要直接转成一条，也不要重复罗列文件。
5. 同时存在 A 和 F 时，严禁使用单行 "A | F" 格式，必须使用复杂提交的序号列表。
6. 只输出最终 commit 内容，禁止输出 "更新内容："、"[A为功能增加 F为BUG修复]：" 等标题行。
7. 禁止输出思考过程、分析、解释、总结、备注、"根据 diff"、"以下是"等任何前缀或后缀。
8. 禁止用三个反引号代码块包裹输出。
9. 每个描述必须简洁、具体、面向用户价值，不写 "优化"、"调整" 等模糊词汇。
9. 单行提交必须保留 A 或 F 字母标识，例如 "<feat> A ..." 或 "<fix> F ..."。

请直接生成最终 commit 信息。`;
  }

  public async copyCommit(commit: string) {
    if (!commit) {
      return;
    }
    await vscode.env.clipboard.writeText(commit);
  }

  public async promptCopy() {
    if (this._view) {
      this._view.webview.postMessage({ command: "triggerCopy" });
    }
  }

  public async refreshDiff() {
    await this._refreshChanges();
  }

  /**
   * 在 message 框中插入简化规范模板，供用户手动填写
   */
  private _insertTemplate() {
    if (!this._view) {
      return;
    }
    const template = `更新内容：
[A为功能增加 F为BUG修复]：

<feat> A 新增内容 | <fix> F 修改内容

或
<feat> 提交了xxx

1. A 具体功能描述
2. F 具体修复描述`;
    this._view.webview.postMessage({ command: "templateInserted", template });
  }

  /**
   * 渲染侧边栏 Webview HTML
   * 设计要点：
   *  - message 框自适应高度（最小 240px，按内容增长到约 70vh），确保能查看大部分提交内容
   *  - 配置项改动勾选控件、A/F 类型、统计条、变更文件列表
   *  - 完整 focus ring / hover / active / loading / empty / error 状态
   */
  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --r-sm: 3px;
      --r-md: 6px;
      --r-lg: 8px;
      --ease: cubic-bezier(0.4, 0, 0.2, 1);
      --dur: 160ms;
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 0 0 8px;
      -webkit-font-smoothing: antialiased;
    }
    button { font-family: inherit; }

    /* ===== 状态提示 ===== */
    #statusToast {
      position: fixed;
      top: 8px;
      left: 8px;
      right: 8px;
      z-index: 100;
      padding: 8px 12px;
      border-radius: var(--r-md);
      font-size: 12px;
      line-height: 1.4;
      display: none;
      border: 1px solid transparent;
      backdrop-filter: blur(6px);
      transform: translateY(-6px);
      opacity: 0;
      transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
    }
    #statusToast.show { display: block; }
    #statusToast.in { transform: translateY(0); opacity: 1; }
    .status-success { background: var(--vscode-testing-runPassed, rgba(38,162,32,0.18)); color: var(--vscode-testing-runPassed, #3fb950); border-color: rgba(63,185,80,0.3); }
    .status-error { background: var(--vscode-testing-runFailed, rgba(218,54,51,0.18)); color: var(--vscode-testing-runFailed, #f14c4c); border-color: rgba(241,76,76,0.3); }
    .status-info { background: var(--vscode-notificationsInfoIcon-foreground, rgba(0,120,212,0.18)); color: var(--vscode-notificationsInfoIcon-foreground, #0078d4); border-color: rgba(0,120,212,0.3); }

    /* ===== 区块通用 ===== */
    .panel { padding: 0 12px; }
    .panel + .panel { margin-top: 10px; }

    .label-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    /* ===== 配置项勾选 ===== */
    .config-toggle {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
    }
    .config-toggle button {
      flex: 1;
      padding: 7px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: var(--r-md);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
    }
    .config-toggle button:hover { background: var(--vscode-list-hoverBackground); }
    .config-toggle button:active { transform: scale(0.98); }
    .config-toggle button.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .config-toggle button:focus-visible {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .check-mark { font-size: 13px; line-height: 1; }

    /* ===== message 框：自适应高度，能查看大部分提交 ===== */
    .message-box { position: relative; }
    .message-textarea {
      width: 100%;
      min-height: 240px;
      max-height: 70vh;
      padding: 10px 12px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: var(--r-md);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-editor-font-family, 'SF Mono', Menlo, Consolas, monospace);
      font-size: 12.5px;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      overflow-y: auto;
      transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message-textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
      opacity: 0.75;
    }
    .message-textarea:focus {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }
    .message-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .msg-tools { display: flex; gap: 4px; }
    .tool-btn {
      padding: 3px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: var(--r-sm);
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      cursor: pointer;
      transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
    }
    .tool-btn:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
    .tool-btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }

    /* ===== 操作按钮组 ===== */
    .actions-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .ai-btn, .copy-btn {
      flex: 1;
      height: 32px;
      border: none;
      border-radius: var(--r-md);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background var(--dur) var(--ease), transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
    }
    .ai-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .ai-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .ai-btn:active:not(:disabled) { transform: scale(0.985); }
    .ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .copy-btn {
      flex: 0 0 44px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .copy-btn:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .copy-btn:active:not(:disabled) { transform: scale(0.96); }
    .ai-btn:focus-visible, .copy-btn:focus-visible {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    /* ===== Commit 按钮组 ===== */
    .commit-actions {
      display: flex;
      gap: 0;
      margin-top: 10px;
      position: relative;
    }
    .commit-btn-group {
      display: flex;
      flex: 1;
      height: 30px;
      border-radius: var(--r-md);
      overflow: hidden;
      background: var(--vscode-button-background);
    }
    .btn-commit-main, .btn-commit-dropdown {
      border: none;
      background: transparent;
      color: var(--vscode-button-foreground);
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--dur) var(--ease);
    }
    .btn-commit-main { flex: 1; gap: 6px; }
    .btn-commit-dropdown {
      width: 26px;
      border-left: 1px solid rgba(255,255,255,0.18);
      font-size: 9px;
    }
    .commit-btn-group:hover:not(.disabled) { background: var(--vscode-button-hoverBackground); }
    .commit-btn-group.disabled { opacity: 0.45; cursor: not-allowed; background: var(--vscode-button-background); }

    /* ===== 下拉菜单 ===== */
    .dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: var(--r-md);
      box-shadow: 0 6px 18px rgba(0,0,0,0.28);
      z-index: 50;
      min-width: 168px;
      display: none;
      overflow: hidden;
    }
    .dropdown.show { display: block; animation: dropIn var(--dur) var(--ease); }
    @keyframes dropIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .dropdown-item {
      padding: 8px 12px;
      font-size: 12.5px;
      cursor: pointer;
      color: var(--vscode-dropdown-foreground);
      transition: background var(--dur) var(--ease);
    }
    .dropdown-item:hover { background: var(--vscode-list-hoverBackground); }

    /* ===== 统计条 ===== */
    .stats-bar {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    .stat-chip {
      flex: 1;
      padding: 6px 8px;
      border-radius: var(--r-md);
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
    }
    .stat-chip .num {
      font-size: 14px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .stat-chip .lbl {
      font-size: 10px;
      letter-spacing: 0.4px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
    }
    .stat-chip.add .num { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
    .stat-chip.del .num { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }

    /* ===== Changes 区 ===== */
    .section-header {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground);
      background: var(--vscode-sideBarSectionHeader-background);
      cursor: pointer;
      user-select: none;
      transition: background var(--dur) var(--ease);
    }
    .section-header:hover { background: var(--vscode-list-hoverBackground); }
    .collapse-icon {
      font-size: 9px;
      width: 12px;
      transition: transform var(--dur) var(--ease);
    }
    .collapse-icon.collapsed { transform: rotate(-90deg); }
    .change-count {
      margin-left: 2px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    .section-actions {
      margin-left: auto;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity var(--dur) var(--ease);
    }
    .section-header:hover .section-actions { opacity: 1; }
    .section-action-btn {
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--r-sm);
      font-size: 13px;
      transition: background var(--dur) var(--ease);
    }
    .section-action-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .section-action-btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }

    /* ===== 文件列表 ===== */
    .file-list { padding: 2px 0; }
    .file-list.collapsed { display: none; }
    .file-item {
      display: flex;
      align-items: center;
      height: 26px;
      padding: 0 12px 0 4px;
      cursor: pointer;
      position: relative;
      transition: background var(--dur) var(--ease);
    }
    .file-item:hover { background: var(--vscode-list-hoverBackground); }
    .file-item:active { background: var(--vscode-list-activeSelectionBackground); }
    .file-item.deleted .file-name {
      text-decoration: line-through;
      opacity: 0.55;
      color: var(--vscode-descriptionForeground);
    }
    .file-status {
      width: 16px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      margin-right: 7px;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .file-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 5px;
    }
    .file-name {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-dir {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 1;
    }
    .file-actions {
      display: flex;
      gap: 1px;
      opacity: 0;
      transition: opacity var(--dur) var(--ease);
    }
    .file-item:hover .file-actions { opacity: 1; }
    .file-action-btn {
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--r-sm);
      font-size: 13px;
      transition: background var(--dur) var(--ease);
    }
    .file-action-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .file-action-btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .file-action-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
      background: transparent !important;
    }
    .stage-badge {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-right: 4px;
      opacity: 0.7;
    }
    .file-image-icon {
      font-size: 12px;
      line-height: 1;
      margin-right: 4px;
      opacity: 0.85;
      flex-shrink: 0;
    }

    /* ===== 空状态 ===== */
    .empty-state {
      padding: 28px 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.6;
    }
    .empty-state .glyph {
      font-size: 26px;
      opacity: 0.4;
      margin-bottom: 8px;
      display: block;
    }

    /* ===== 加载骨架 ===== */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 18px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
      border-top-color: var(--vscode-progressBar-background);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* 滚动条 */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 5px; border: 2px solid transparent; background-clip: content-box; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); background-clip: content-box; }
  </style>
</head>
<body>
  <div id="statusToast"></div>

  <!-- 统计条 -->
  <div class="panel">
    <div class="stats-bar">
      <div class="stat-chip"><span class="num" id="statFiles">0</span><span class="lbl">文件</span></div>
      <div class="stat-chip add"><span class="num" id="statAdd">+0</span><span class="lbl">新增</span></div>
      <div class="stat-chip del"><span class="num" id="statDel">−0</span><span class="lbl">删除</span></div>
    </div>
  </div>

  <!-- Message 输入区 -->
  <div class="panel">
    <div class="label-row">提交信息（Message）</div>
    <div class="message-box">
      <textarea
        id="commitMessage"
        class="message-textarea"
        spellcheck="false"
        placeholder="点击下方「AI 生成」自动填充，或点击「模板」手动填写规范 commit..."
        aria-label="提交信息"
      ></textarea>
    </div>
    <div class="message-meta">
      <span><span id="charCount">0</span> 字符 · Ctrl+Enter 提交</span>
      <div class="msg-tools">
        <button class="tool-btn" id="btnTemplate" type="button">模板</button>
        <button class="tool-btn" id="btnClear" type="button">清空</button>
      </div>
    </div>

    <!-- AI 生成 + 复制 -->
    <div class="actions-row">
      <button id="btnGenerate" class="ai-btn" type="button">✦ AI 生成 Commit</button>
      <button id="btnCopy" class="copy-btn" title="复制到剪贴板" type="button" aria-label="复制">⧉</button>
    </div>

    <!-- Commit 按钮组 -->
    <div class="commit-actions">
      <div class="commit-btn-group disabled" id="commitGroup">
        <button id="btnCommit" class="btn-commit-main" type="button" disabled>✓ Commit</button>
        <button id="btnCommitDropdown" class="btn-commit-dropdown" type="button" aria-label="更多提交选项">▼</button>
      </div>
      <!-- Commit 下拉菜单 -->
      <div id="commitDropdown" class="dropdown">
        <div class="dropdown-item" data-mode="commit">✓ Commit</div>
        <div class="dropdown-item" data-mode="push">↑ Commit &amp; Push</div>
        <div class="dropdown-item" data-mode="sync">⇅ Commit &amp; Sync</div>
      </div>
    </div>
  </div>

  <!-- Staged Changes 列表 -->
  <section class="changes-section">
    <div class="section-header" id="stagedHeader">
      <span class="collapse-icon" id="stagedCollapseIcon">▼</span>
      <span>Staged Changes</span>
      <span class="change-count" id="stagedCount">0</span>
      <span class="section-actions">
        <button class="section-action-btn" title="全部取消暂存" id="btnUnstageAll" type="button">−</button>
        <button class="section-action-btn" title="刷新" id="btnRefresh2" type="button">↻</button>
      </span>
    </div>
    <div class="file-list" id="stagedFileList">
      <div class="empty-state"><span class="glyph">◌</span>暂无已暂存变更</div>
    </div>
  </section>

  <!-- Changes 列表 -->
  <section class="changes-section">
    <div class="section-header" id="changesHeader">
      <span class="collapse-icon" id="changesCollapseIcon">▼</span>
      <span>Changes</span>
      <span class="change-count" id="changesCount">0</span>
      <span class="section-actions">
        <button class="section-action-btn" title="全部暂存" id="btnStageAll" type="button">+</button>
        <button class="section-action-btn" title="刷新" id="btnRefresh" type="button">↻</button>
      </span>
    </div>
    <div class="file-list" id="fileList">
      <div class="empty-state"><span class="glyph">◌</span>暂无变更</div>
    </div>
  </section>

  <script>
    const vscode = acquireVsCodeApi();
    let isGenerating = false;
    let hasConfig = false;

    const els = {
      toast: document.getElementById('statusToast'),
      message: document.getElementById('commitMessage'),
      charCount: document.getElementById('charCount'),
      btnCommit: document.getElementById('btnCommit'),
      btnDropdown: document.getElementById('btnCommitDropdown'),
      commitGroup: document.getElementById('commitGroup'),
      dropdown: document.getElementById('commitDropdown'),
      btnGenerate: document.getElementById('btnGenerate'),
      btnCopy: document.getElementById('btnCopy'),
      btnTemplate: document.getElementById('btnTemplate'),
      btnClear: document.getElementById('btnClear'),
      statFiles: document.getElementById('statFiles'),
      statAdd: document.getElementById('statAdd'),
      statDel: document.getElementById('statDel'),
      stagedFileList: document.getElementById('stagedFileList'),
      stagedCount: document.getElementById('stagedCount'),
      stagedHeader: document.getElementById('stagedHeader'),
      stagedCollapseIcon: document.getElementById('stagedCollapseIcon'),
      btnUnstageAll: document.getElementById('btnUnstageAll'),
      btnRefresh2: document.getElementById('btnRefresh2'),
      fileList: document.getElementById('fileList'),
      changesCount: document.getElementById('changesCount'),
      changesHeader: document.getElementById('changesHeader'),
      changesCollapseIcon: document.getElementById('changesCollapseIcon'),
      btnStageAll: document.getElementById('btnStageAll'),
      btnRefresh: document.getElementById('btnRefresh'),
    };

    let toastTimer = null;
    function showToast(message, type) {
      els.toast.className = 'show status-' + type;
      els.toast.textContent = message;
      // 强制重绘以触发过渡
      requestAnimationFrame(() => els.toast.classList.add('in'));
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        els.toast.classList.remove('in');
        setTimeout(() => { els.toast.className = ''; }, 180);
      }, 2800);
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, function(m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
      });
    }

    // message 框自适应高度：按内容增长，最多 70vh，确保能查看大部分提交内容
    function autoResize() {
      const ta = els.message;
      ta.style.height = 'auto';
      const maxH = Math.round(window.innerHeight * 0.7);
      const h = Math.min(Math.max(ta.scrollHeight, 240), maxH);
      ta.style.height = h + 'px';
    }

    function updateCommitButton() {
      const hasText = els.message.value.trim().length > 0;
      els.btnCommit.disabled = !hasText;
      els.btnDropdown.disabled = !hasText;
      els.commitGroup.classList.toggle('disabled', !hasText);
    }

    function updateCharCount() {
      els.charCount.textContent = els.message.value.length;
    }

    function renderFileList(container, files, emptyText) {
      if (!files || files.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="glyph">◌</span>' + escapeHtml(emptyText) + '</div>';
        return;
      }

      const html = files.map((file, index) => {
        const statusColor = file.statusColor || 'var(--vscode-foreground)';
        const isStaged = file.isStaged;
        const actionIcon = isStaged ? '−' : '+';
        const actionTitle = isStaged ? '取消暂存' : '暂存';
        const actionCommand = isStaged ? 'unstageFile' : 'stageFile';

        const isDeleted = file.statusLetter === 'D';
        const imageIcon = file.isImage ? '<span class="file-image-icon" title="图片">🖼</span>' : '';

        return '<div class="file-item' + (isDeleted ? ' deleted' : '') + '" data-index="' + index + '" data-path="' + escapeHtml(file.fullPath) + '"' +
          (file.originalFullPath ? ' data-original-path="' + escapeHtml(file.originalFullPath) + '"' : '') +
          '>' +
          '<div class="file-status" style="color:' + statusColor + '">' + file.statusLetter + '</div>' +
          '<div class="file-info">' +
            imageIcon +
            '<span class="file-name">' + escapeHtml(file.filename) + '</span>' +
            (file.dir ? '<span class="file-dir">' + escapeHtml(file.dir) + '</span>' : '') +
          '</div>' +
          '<div class="file-actions">' +
            '<button class="file-action-btn" title="' + actionTitle + '" data-cmd="' + actionCommand + '"' + (isDeleted ? ' disabled' : '') + '>' + actionIcon + '</button>' +
            (isDeleted ? '' : '<button class="file-action-btn" title="放弃更改" data-cmd="discardFile">↺</button>') +
          '</div>' +
        '</div>';
      }).join('');

      container.innerHTML = html;

      container.querySelectorAll('.file-item').forEach(item => {
        const filepath = item.dataset.path;
        const originalFilepath = item.dataset.originalPath;
        const file = files[item.dataset.index];
        item.addEventListener('click', (e) => {
          if (e.target.closest('.file-actions')) return;
          vscode.postMessage({ command: 'openFile', filepath, status: file.status, originalFilepath });
        });
      });

      container.querySelectorAll('.file-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.file-item');
          const filepath = item.dataset.path;
          const file = files[item.dataset.index];
          vscode.postMessage({ command: btn.dataset.cmd, filepath, status: file.status });
        });
      });
    }

    function renderChanges(changes, stats) {
      const staged = changes ? (changes.staged || []) : [];
      const unstaged = changes ? (changes.unstaged || []) : [];
      const totalFiles = staged.length + unstaged.length;

      els.changesCount.textContent = unstaged.length;
      els.stagedCount.textContent = staged.length;
      els.statFiles.textContent = totalFiles;
      els.statAdd.textContent = '+' + (stats ? (stats.additions || 0) : 0);
      els.statDel.textContent = '−' + (stats ? (stats.deletions || 0) : 0);

      if (stats && stats.loading) {
        const loading = '<div class="loading"><div class="spinner"></div>正在扫描 Git 变更...</div>';
        els.stagedFileList.innerHTML = loading;
        els.fileList.innerHTML = loading;
        return;
      }

      renderFileList(els.stagedFileList, staged, '暂无已暂存变更');
      renderFileList(els.fileList, unstaged, '暂无变更\\n修改文件后将自动显示');
    }

    // ===== 事件绑定 =====
    els.message.addEventListener('input', () => {
      updateCommitButton();
      updateCharCount();
      autoResize();
    });

    els.message.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter' && els.message.value.trim()) {
        vscode.postMessage({ command: 'commit', message: els.message.value, mode: 'commit' });
      }
    });

    els.btnCommit.addEventListener('click', () => {
      if (els.message.value.trim()) {
        vscode.postMessage({ command: 'commit', message: els.message.value, mode: 'commit' });
      }
    });

    els.btnDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!els.btnDropdown.disabled) {
        els.dropdown.classList.toggle('show');
      }
    });

    els.dropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        els.dropdown.classList.remove('show');
        if (els.message.value.trim()) {
          vscode.postMessage({ command: 'commit', message: els.message.value, mode: item.dataset.mode });
        }
      });
    });

    document.addEventListener('click', () => els.dropdown.classList.remove('show'));

    els.btnGenerate.addEventListener('click', () => {
      if (isGenerating) return;
      isGenerating = true;
      els.btnGenerate.disabled = true;
      els.btnGenerate.innerHTML = '<div class="spinner"></div> AI 生成中...';
      vscode.postMessage({ command: 'generateCommit' });
    });

    els.btnCopy.addEventListener('click', () => {
      if (els.message.value.trim()) {
        vscode.postMessage({ command: 'copyCommit', commit: els.message.value });
        showToast('已复制到剪贴板', 'success');
      }
    });

    els.btnTemplate.addEventListener('click', () => {
      vscode.postMessage({ command: 'insertTemplate' });
    });

    els.btnClear.addEventListener('click', () => {
      els.message.value = '';
      updateCommitButton();
      updateCharCount();
      autoResize();
      els.message.focus();
    });

    // Staged Changes 折叠
    let stagedCollapsed = false;
    els.stagedHeader.addEventListener('click', (e) => {
      if (e.target.closest('.section-actions')) return;
      stagedCollapsed = !stagedCollapsed;
      els.stagedFileList.classList.toggle('collapsed', stagedCollapsed);
      els.stagedCollapseIcon.classList.toggle('collapsed', stagedCollapsed);
    });

    // Changes 折叠
    let changesCollapsed = false;
    els.changesHeader.addEventListener('click', (e) => {
      if (e.target.closest('.section-actions')) return;
      changesCollapsed = !changesCollapsed;
      els.fileList.classList.toggle('collapsed', changesCollapsed);
      els.changesCollapseIcon.classList.toggle('collapsed', changesCollapsed);
    });

    // Staged 区 action：全部取消暂存、刷新
    els.btnUnstageAll.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ command: 'unstageAll' });
    });
    els.btnRefresh2.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ command: 'refreshDiff' });
    });

    // Changes 区 action：全部暂存、刷新
    els.btnStageAll.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ command: 'stageAll' });
    });
    els.btnRefresh.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ command: 'refreshDiff' });
    });

    // 接收扩展消息
    window.addEventListener('message', function(event) {
      const message = event.data;

      if (message.command === 'commitGenerated') {
        els.message.value = (message.commit || '').trim();
        updateCommitButton();
        updateCharCount();
        autoResize();
        showToast('AI 生成完成', 'success');
      } else if (message.command === 'templateInserted') {
        els.message.value = message.template;
        updateCommitButton();
        updateCharCount();
        autoResize();
        els.message.focus();
        els.message.setSelectionRange(0, 0);
        showToast('已插入规范模板', 'info');
      } else if (message.command === 'error') {
        showToast(message.error, 'error');
      } else if (message.command === 'status') {
        showToast(message.message, message.type);
      } else if (message.command === 'clearMessage') {
        els.message.value = '';
        updateCommitButton();
        updateCharCount();
        autoResize();
      } else if (message.command === 'diffStats') {
        renderChanges(message.changes, message);
      }

      if (message.command === 'commitGenerated' ||
          message.command === 'error' ||
          message.command === 'generatingDone') {
        isGenerating = false;
        els.btnGenerate.disabled = false;
        els.btnGenerate.innerHTML = '✦ AI 生成 Commit';
      }
    });

    // 初始化
    updateCommitButton();
    updateCharCount();
    autoResize();
    window.addEventListener('resize', autoResize);
    vscode.postMessage({ command: 'refreshDiff' });
  </script>
</body>
</html>`;
  }
}
