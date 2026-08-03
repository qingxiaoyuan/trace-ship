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
  repoName: string; // 所属仓库名（多仓库场景用于分组展示）
  isConflict?: boolean; // 是否为合并冲突文件（Source Control 风格单独分组）
}

/**
 * 单个仓库的变更分组（多仓库/子模块场景：主仓库 + 各子仓库各占一组）
 */
interface RepoGroup {
  repoName: string;
  repoRoot: string;
  conflicts: RepoChange[];
  staged: RepoChange[];
  unstaged: RepoChange[];
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  needsSync: boolean;
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
  private _aiAbortControllers: Map<string, AbortController> = new Map(); // 按仓库隔离的 AI 生成中断控制器
  private _outputChannel?: vscode.OutputChannel; // 日志输出通道

  constructor(extensionUri: vscode.Uri, outputChannel?: vscode.OutputChannel) {
    this._extensionUri = extensionUri;
    this._outputChannel = outputChannel;
  }

  /**
   * 输出日志到 VS Code OutputChannel，同时保留 console.log 便于调试。
   */
  private _log(message: string) {
    const line = `[规范提交助手] ${message}`;
    this._outputChannel?.appendLine(line);
    console.log(line);
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
              await this.generateCommit(message.repoRoot);
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
            case "openMergeEditor":
              await this.openMergeEditor(message.filepath);
              break;
            case "resolveConflict":
              await this.resolveConflict(message.filepath, message.strategy);
              break;
            case "stageFile":
              await this.stageFile(message.filepath);
              break;
            case "stageAll":
              await this.stageAll(message.repoRoot);
              break;
            case "unstageFile":
              await this.unstageFile(message.filepath);
              break;
            case "unstageAll":
              await this.unstageAll(message.repoRoot);
              break;
            case "discardFile":
              await this.discardFile(message.filepath, message.status);
              break;
            case "commit":
              await this.commit(message.message, message.mode, message.repoRoot);
              break;
            case "insertTemplate":
              this._insertTemplate(message.repoRoot);
              break;
            case "stopGenerateCommit":
              this.stopGenerateCommit(message.repoRoot);
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
   * 监听 Git 状态变化，自动刷新更改列表
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
              gitApi.onDidOpenRepository((repo: any) => {
                this._bindRepo(repo);
                // 关键：VS Code 异步打开仓库（子模块检测尤其慢），
                // 新仓库打开后必须主动触发一次刷新，否则它永远不会出现在面板中
                this._scheduleRefresh();
              }),
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
   * 刷新更改列表到 Webview
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

      // 输出每个仓库扫描到的变更数，便于排查多仓库识别问题
      this._log(
        `[扫描] 共 ${changes.groups.length} 个仓库：` +
          changes.groups
            .map(
              (g) =>
                `${g.repoName}(冲突 ${g.conflicts.length}/暂存 ${g.staged.length}/未暂存 ${g.unstaged.length})`,
            )
            .join("，"),
      );

      this._view.webview.postMessage({
        command: "diffStats",
        additions: stats.additions,
        deletions: stats.deletions,
        aiContextChars: stats.aiContextChars,
        files:
          changes.conflicts.length +
          changes.staged.length +
          changes.unstaged.length,
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

  private _getRepoSyncState(repo: any): {
    ahead: number;
    behind: number;
    hasUpstream: boolean;
    needsSync: boolean;
  } {
    const head = repo?.state?.HEAD;
    const ahead = typeof head?.ahead === "number" ? head.ahead : 0;
    const behind = typeof head?.behind === "number" ? head.behind : 0;
    const hasUpstream = Boolean(head?.upstream);
    return {
      ahead,
      behind,
      hasUpstream,
      needsSync: hasUpstream && behind > 0,
    };
  }

  private _isConflictStatus(status: GitStatus, Status: any): boolean {
    const conflictKeys = [
      "UNMERGED",
      "ADDED_BY_US",
      "ADDED_BY_THEM",
      "DELETED_BY_US",
      "DELETED_BY_THEM",
      "BOTH_ADDED",
      "BOTH_DELETED",
      "BOTH_MODIFIED",
    ];
    return conflictKeys.some(
      (key) => typeof Status?.[key] === "number" && status === Status[key],
    );
  }

  private _getRepoConflicts(repo: any, Status: any): GitChange[] {
    const mergeChanges = Array.isArray(repo?.state?.mergeChanges)
      ? (repo.state.mergeChanges as GitChange[])
      : [];
    if (mergeChanges.length > 0) {
      return mergeChanges;
    }
    return ((repo?.state?.workingTreeChanges || []) as GitChange[]).filter(
      (change) => this._isConflictStatus(change.status, Status),
    );
  }

  private _collectChanges(gitApi: any): {
    conflicts: RepoChange[];
    staged: RepoChange[];
    unstaged: RepoChange[];
    groups: RepoGroup[];
  } {
    const repos: any[] = gitApi.repositories || [];
    const conflicts: RepoChange[] = [];
    const staged: RepoChange[] = [];
    const unstaged: RepoChange[] = [];
    const groups: RepoGroup[] = [];
    const Status = this._getStatusEnum(gitApi);

    const map = (
      change: GitChange,
      repoRoot: string,
      isStaged: boolean,
      isConflict: boolean = false,
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
        repoName: path.basename(repoRoot),
        isConflict,
      };
    };

    for (const repo of repos) {
      const rootPath = repo.rootUri.fsPath;
      const workingChanges = (repo.state.workingTreeChanges || []) as GitChange[];
      const conflictChanges = this._getRepoConflicts(repo, Status);
      const conflictPaths = new Set(conflictChanges.map((c) => c.uri.fsPath));

      const repoConflicts: RepoChange[] = conflictChanges.map((c) =>
        map(c, rootPath, false, true),
      );
      const repoStaged: RepoChange[] = (
        (repo.state.indexChanges || []) as GitChange[]
      ).map((c) => map(c, rootPath, true));
      const repoUnstaged: RepoChange[] = workingChanges
        .filter(
          (c) =>
            !this._isConflictStatus(c.status, Status) &&
            !conflictPaths.has(c.uri.fsPath),
        )
        .map((c) => map(c, rootPath, false));

      repoConflicts.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
      repoStaged.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
      repoUnstaged.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
      conflicts.push(...repoConflicts);
      staged.push(...repoStaged);
      unstaged.push(...repoUnstaged);
      const syncState = this._getRepoSyncState(repo);
      groups.push({
        repoName: path.basename(rootPath),
        repoRoot: rootPath,
        conflicts: repoConflicts,
        staged: repoStaged,
        unstaged: repoUnstaged,
        ahead: syncState.ahead,
        behind: syncState.behind,
        hasUpstream: syncState.hasUpstream,
        needsSync: syncState.needsSync,
      });
    }

    conflicts.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    staged.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    unstaged.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    groups.sort((a, b) => a.repoRoot.localeCompare(b.repoRoot));
    return { conflicts, staged, unstaged, groups };
  }

  private _statusToLetter(status: GitStatus, Status: any): string {
    if (this._isConflictStatus(status, Status)) {
      return "!";
    }
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
    if (this._isConflictStatus(status, Status)) {
      return "var(--vscode-gitDecoration-conflictingResourceForeground, #e2a05c)";
    }
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
    aiContextChars: number;
  }> {
    try {
      const gitApi = await this._getGitApi();
      const repos: any[] = gitApi.repositories || [];
      if (repos.length === 0) {
        return { additions: 0, deletions: 0, aiContextChars: 0 };
      }

      let additions = 0;
      let deletions = 0;
      let aiContextChars = 0;

      for (const repo of repos) {
        // 复用 _getRepoDiff：含未跟踪文件，统计新增/删除行更准确
        const diffContent = await this._getRepoDiff(repo);
        const stats = this._parseDiffStats(diffContent);
        additions += stats.additions;
        deletions += stats.deletions;

        // 暂存区 diff 是 AI 生成 commit 时的主要上下文，按字符数估算大小
        const stagedDiff = await this._getStagedDiff(repo);
        aiContextChars += stagedDiff.length;
      }

      return { additions, deletions, aiContextChars };
    } catch {
      return { additions: 0, deletions: 0, aiContextChars: 0 };
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
   * 获取仓库暂存区 diff（git diff --cached / git diff --staged），仅含已暂存改动。
   * 过滤掉图片/二进制文件 diff 块，避免它们进入 AI 上下文字符统计。
   */
  private async _getStagedDiff(repo: any): Promise<string> {
    const root: string = repo.rootUri.fsPath;
    try {
      const cached = await execAsync(
        `git -C "${root}" --no-pager diff --cached --no-color --no-ext-diff`,
        { maxBuffer: 20 * 1024 * 1024 },
      );
      const raw = cached.stdout || "";
      const filtered = this._splitDiffByFile(raw).filter((block) => {
        const name = this._extractFilenameFromDiffBlock(block);
        if (this._isBinaryDiffBlock(block)) {
          if (name) {
            this._log(`[_getStagedDiff] 跳过二进制文件: ${name}`);
          }
          return false;
        }
        if (name && this._isImageFile(name)) {
          this._log(`[_getStagedDiff] 跳过图片/二进制文件: ${name}`);
          return false;
        }
        return true;
      });
      return filtered.join("\n");
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
   * 从 diff 块中提取文件名。
   * 优先取 +++ b/<path>，删除文件回退到 --- a/<path>，
   * 二进制文件再从 "Binary files ... b/<path> differ" 中提取。
   * 用于按扩展名跳过图片等不希望进入 AI prompt 的文件。
   */
  private _extractFilenameFromDiffBlock(diffBlock: string): string | undefined {
    const m =
      diffBlock.match(/^\+\+\+ b\/(.+)$/m) ||
      diffBlock.match(/^--- a\/(.+)$/m) ||
      diffBlock.match(/Binary files.*\bb\/(.+?)\s+differ/i);
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

    // 找到文件所属的仓库（多仓库/子模块场景取根路径最深的匹配，不能只用 repositories[0]）
    const repo = this._findRepoForPath(gitApi, filepath);
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

  /**
   * 按文件路径定位其所属的 Git 仓库（多仓库/子模块场景）。
   * 当主仓库与子仓库（子模块）嵌套时，一个路径可能同时匹配多个仓库根目录，
   * 这里选择根路径最深的那个，确保命中实际管理该文件的子仓库。
   * 注意：不匹配"路径恰好等于仓库根"的情况——那是父仓库中的子模块条目（gitlink），
   * 其暂存/取消暂存必须通过父仓库执行（git add <子模块路径> 是更新指针）。
   */
  private _findRepoForPath(gitApi: any, filepath: string): any {
    const repos: any[] = gitApi?.repositories || [];
    let best: any = null;
    for (const repo of repos) {
      const root: string = repo.rootUri?.fsPath || "";
      if (!root) {
        continue;
      }
      if (filepath.startsWith(root + path.sep)) {
        if (!best || root.length > best.rootUri.fsPath.length) {
          best = repo;
        }
      }
    }
    return best;
  }

  private async stageFile(filepath: string) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi ? this._findRepoForPath(gitApi, filepath) : null;
    if (!repo) {
      this._log(`[暂存] 未找到文件所属仓库: ${filepath}`);
      return;
    }
    // 注意：vscode.git API 的 add/revert 形参类型虽标注为 Uri[]，
    // 但实际实现是内部自己做 Uri.file(e) 转换（add(e){return this.#i.add(e.map(e=>Uri.file(e)))}），
    // 必须传字符串路径；传 Uri 对象会被二次转换产出非法路径导致操作失败
    await repo.add([filepath]);
    await this._refreshChanges();
  }

  /**
   * 打开冲突文件的合并编辑器（Source Control 同款入口）。
   * 优先走 Git 扩展的 openMergeEditor；老版本退化为 mergeEditor/openWith，最后直接打开文件。
   */
  private async openMergeEditor(filepath: string) {
    const uri = vscode.Uri.file(filepath);
    try {
      await vscode.commands.executeCommand("git.openMergeEditor", uri);
      return;
    } catch {
      // 继续尝试下一个入口
    }
    try {
      await vscode.commands.executeCommand("vscode.openWith", uri, "mergeEditor");
      return;
    } catch {
      // 继续退化
    }
    await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
  }

  /**
   * 冲突解决：manual 表示用户已在编辑器中处理完，直接暂存标记解决；
   * ours/theirs 对应 Source Control 的“采用当前更改/采用传入更改”。
   */
  private async resolveConflict(
    filepath: string,
    strategy?: "ours" | "theirs" | "manual",
  ) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi ? this._findRepoForPath(gitApi, filepath) : null;
    if (!repo) {
      this._view?.webview.postMessage({
        command: "error",
        error: "未找到冲突文件所属的 Git 仓库",
      });
      return;
    }

    const normalized = strategy === "ours" || strategy === "theirs" ? strategy : "manual";
    if (normalized === "manual") {
      await repo.add([filepath]);
      await this._refreshChanges();
      return;
    }

    const root = repo.rootUri.fsPath;
    const rel = path.relative(root, filepath).replace(/\\/g, "/");
    const escapedRel = rel.replace(/"/g, '\\"');
    await execAsync(`git -C "${root}" checkout --${normalized} -- "${escapedRel}"`);
    await execAsync(`git -C "${root}" add -- "${escapedRel}"`);
    await this._refreshChanges();
    this._view?.webview.postMessage({
      command: "status",
      message:
        normalized === "ours" ? "已采用当前更改并标记解决" : "已采用传入更改并标记解决",
      type: "success",
    });
  }

  /**
   * 暂存所有未暂存文件（遍历所有仓库：主仓库 + 子仓库）
   * 传入 repoRoot 时只暂存该仓库的变更（多仓库分组界面中按仓库操作）
   */
  private async stageAll(repoRoot?: string) {
    const gitApi = await this._getGitApi().catch(() => null);
    let repos: any[] = gitApi?.repositories || [];
    if (repos.length === 0) {
      return;
    }
    if (repoRoot) {
      repos = repos.filter((r: any) => r.rootUri?.fsPath === repoRoot);
    }
    const Status = this._getStatusEnum(gitApi);
    for (const repo of repos) {
      const paths = (repo.state.workingTreeChanges || [])
        .filter((c: GitChange) => !this._isConflictStatus(c.status, Status))
        .map((c: GitChange) => c.uri.fsPath);
      if (paths.length === 0) {
        continue;
      }
      await repo.add(paths);
    }
    await this._refreshChanges();
  }

  private async unstageFile(filepath: string) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi ? this._findRepoForPath(gitApi, filepath) : null;
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
   * 取消暂存所有已暂存文件（遍历所有仓库：主仓库 + 子仓库）
   * 传入 repoRoot 时只取消该仓库的暂存（多仓库分组界面中按仓库操作）
   */
  private async unstageAll(repoRoot?: string) {
    const gitApi = await this._getGitApi().catch(() => null);
    let repos: any[] = gitApi?.repositories || [];
    if (repos.length === 0) {
      return;
    }
    if (repoRoot) {
      repos = repos.filter((r: any) => r.rootUri?.fsPath === repoRoot);
    }
    for (const repo of repos) {
      if ((repo.state.indexChanges?.length ?? 0) === 0) {
        continue;
      }
      const root = repo.rootUri.fsPath;
      await execAsync(`git -C "${root}" reset HEAD -- .`);
      await repo.status();
    }
    await this._refreshChanges();
  }

  private async discardFile(filepath: string, status: GitStatus) {
    const gitApi = await this._getGitApi().catch(() => null);
    const repo = gitApi ? this._findRepoForPath(gitApi, filepath) : null;
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

  private async commit(
    message: string,
    mode: "commit" | "push" | "sync",
    repoRoot?: string,
  ) {
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
    let repos: any[] = gitApi.repositories || [];
    if (repos.length === 0) {
      this._view?.webview.postMessage({
        command: "error",
        error: "未找到 Git 仓库",
      });
      return;
    }
    // 多仓库场景：指定 repoRoot 时只提交该仓库；未指定时提交所有有暂存内容的仓库
    if (repoRoot) {
      repos = repos.filter((r: any) => r.rootUri?.fsPath === repoRoot);
      if (repos.length === 0) {
        this._view?.webview.postMessage({
          command: "error",
          error: "未找到指定的 Git 仓库",
        });
        return;
      }
    }

    try {
      await Promise.all(
        repos.map((r: any) =>
          Promise.resolve()
            .then(() => r.status())
            .catch(() => {}),
        ),
      );

      const Status = this._getStatusEnum(gitApi);
      const conflictRepos = repos.filter(
        (r: any) => this._getRepoConflicts(r, Status).length > 0,
      );
      if (conflictRepos.length > 0) {
        this._view?.webview.postMessage({
          command: "error",
          error: "存在未解决的合并冲突，请先在“冲突”分组中解决后再提交",
        });
        return;
      }

      // 判断是否为纯同步：sync 模式且无本地变更时无需提交信息；有本地变更则必须先提交
      const hasLocalChanges = repos.some(
        (r: any) =>
          (r.state.indexChanges?.length ?? 0) > 0 ||
          (r.state.workingTreeChanges?.length ?? 0) > 0,
      );
      const isPureSync = mode === "sync" && !hasLocalChanges;
      if (!isPureSync && !message.trim()) {
        this._view?.webview.postMessage({
          command: "error",
          error: "请输入提交信息",
        });
        return;
      }

      // 多仓库（主仓库 + 子仓库）场景：对所有有暂存内容的仓库分别提交
      let targetRepos = repos.filter(
        (r: any) => (r.state.indexChanges?.length ?? 0) > 0,
      );
      if (targetRepos.length === 0 && isPureSync) {
        // 纯同步：无本地变更，仅对有上游分支的仓库执行 pull/push
        targetRepos = repos.filter(
          (r: any) => Boolean(r?.state?.HEAD?.upstream),
        );
        if (targetRepos.length === 0) {
          this._view?.webview.postMessage({
            command: "error",
            error: "没有可同步的仓库",
          });
          return;
        }
      } else if (targetRepos.length === 0) {
        // 没有任何仓库暂存内容：把所有仓库的工作区变更全部暂存后提交
        // 注意：repo.add() 后 state.indexChanges 依赖文件事件异步刷新，
        // 不能立刻用 state 判断，这里显式记录成功暂存的仓库
        const stagedRepos: any[] = [];
        for (const repo of repos) {
          const paths = (repo.state.workingTreeChanges || [])
            .filter(
              (c: GitChange) => !this._isConflictStatus(c.status, Status),
            )
            .map((c: GitChange) => c.uri.fsPath);
          if (paths.length === 0) {
            continue;
          }
          await repo.add(paths);
          stagedRepos.push(repo);
        }
        if (stagedRepos.length === 0) {
          this._view?.webview.postMessage({
            command: "error",
            error: "没有可提交的变更",
          });
          return;
        }
        targetRepos = stagedRepos;
      }

      // 远端落后时自动切换为同步流程，避免提交/推送被远端拒绝
      let effectiveMode: "commit" | "push" | "sync" = mode;
      const needsSyncRepos = targetRepos.filter(
        (r: any) => this._getRepoSyncState(r).needsSync,
      );
      if (
        (effectiveMode === "commit" || effectiveMode === "push") &&
        needsSyncRepos.length > 0
      ) {
        effectiveMode = "sync";
        this._view?.webview.postMessage({
          command: "status",
          message: "检测到远端有需要同步的提交，已切换为同步提交",
          type: "info",
        });
      }

      // 逐仓库提交（同一提交信息应用到每个有变更的仓库）；纯同步无本地变更时不提交
      if (!isPureSync) {
        for (const repo of targetRepos) {
          await repo.commit(message);
        }
        this._view?.webview.postMessage({
          command: "status",
          message:
            targetRepos.length > 1
              ? `提交成功（${targetRepos.length} 个仓库）`
              : "提交成功",
          type: "success",
        });
      }

      if (effectiveMode === "push") {
        for (const repo of targetRepos) {
          await repo.push();
        }
        this._view?.webview.postMessage({
          command: "status",
          message: "已提交并推送",
          type: "success",
        });
      } else if (effectiveMode === "sync") {
        for (const repo of targetRepos) {
          await repo.pull();
          await repo.push();
        }
        this._view?.webview.postMessage({
          command: "status",
          message: "已同步",
          type: "success",
        });
      }

      await this._refreshChanges();
      this._view?.webview.postMessage({ command: "clearMessage", repoRoot });
    } catch (err: any) {
      this._view?.webview.postMessage({
        command: "error",
        error: err.message || "提交失败",
      });
    }
  }

  /**
   * 生成 AI commit 信息并填入对应仓库的 Message 输入框
   * 多仓库场景：传入 repoRoot 时只基于该仓库的暂存区生成
   */
  public async generateCommit(repoRoot?: string) {
    if (!this._view) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration("commit");
    const apiEndpoint = cfg.get("apiEndpoint") as string;
    const apiKey = cfg.get("apiKey") as string;
    const model = cfg.get("model") as string;
    const apiProtocol = cfg.get("apiProtocol") as string;

    if (!apiKey) {
      this._view.webview.postMessage({
        command: "error",
        error: "请先在设置中配置 AI API 密钥",
      });
      return;
    }

    let targetRoot: string | undefined;

    try {
      const gitApi = await this._getGitApi();
      let repos: any[] = gitApi.repositories || [];
      if (repos.length === 0) {
        throw new Error("未找到 Git 仓库");
      }
      // 多仓库场景：指定 repoRoot 时只基于该仓库的暂存区生成
      if (repoRoot) {
        repos = repos.filter((r: any) => r.rootUri?.fsPath === repoRoot);
        if (repos.length === 0) {
          throw new Error("未找到指定的 Git 仓库");
        }
        targetRoot = repoRoot;
      } else {
        // 未指定时取第一个仓库（单仓库兼容）
        targetRoot = repos[0].rootUri.fsPath;
      }

      if (!targetRoot) {
        return;
      }

      // 按仓库隔离：同一仓库防重入，不同仓库可并发
      if (this._aiAbortControllers.has(targetRoot)) {
        return;
      }

      // 初始化中断控制器并通知前端生成已开始
      const controller = new AbortController();
      this._aiAbortControllers.set(targetRoot, controller);
      this._view.webview.postMessage({ command: "generatingStarted", repoRoot: targetRoot });

      await Promise.all(repos.map((r: any) => this._waitRepoStateReady(r)));

      // 冲突未解决时不进入 AI 生成，避免把冲突标记/中间态带进提交信息
      const Status = this._getStatusEnum(gitApi);
      const conflictCount = repos.reduce(
        (sum, repo) => sum + this._getRepoConflicts(repo, Status).length,
        0,
      );
      if (conflictCount > 0) {
        this._view.webview.postMessage({
          command: "error",
          error: "存在未解决的合并冲突，请先解决冲突",
        });
        this._view.webview.postMessage({ command: "generatingDone", repoRoot: targetRoot });
        return;
      }

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
        this._view.webview.postMessage({ command: "generatingDone", repoRoot: targetRoot });
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
        this._view.webview.postMessage({ command: "generatingDone", repoRoot: targetRoot });
        return;
      }

      const stats = this._parseDiffStats(diffToUse);
      const changes = this._collectChanges(gitApi);

      this._view.webview.postMessage({
        command: "diffStats",
        additions: stats.additions,
        deletions: stats.deletions,
        files:
          changes.conflicts.length +
          changes.staged.length +
          changes.unstaged.length,
        changes,
      });

      // 两阶段生成：先按文件生成一句话摘要，再汇总提炼最终 commit，避免单 prompt 过长
      // 过滤掉二进制文件和图片（图片不进入 AI prompt，仅由文件名参与统计）
      const MAX_FILE_DIFF_LENGTH = 50000; // 单个文件 diff 最大字符数，防止单文件撑爆 prompt
      const MAX_TOTAL_DIFF_LENGTH = 300000; // 所有文件 diff 总字符数上限（现代模型上下文普遍 128K+，可适当放宽）
      const rawFileDiffs = this._splitDiffByFile(diffToUse).filter((d) => {
        const name = this._extractFilenameFromDiffBlock(d);
        if (this._isBinaryDiffBlock(d)) {
          if (name) {
            this._log(`[SidebarProvider] 跳过二进制文件: ${name}`);
          }
          return false;
        }
        if (name && this._isImageFile(name)) {
          this._log(`[SidebarProvider] 跳过图片/二进制文件: ${name}`);
          return false;
        }
        return true;
      });

      const LOG_PREFIX = "[CommitAI]";
      this._log(
        `${LOG_PREFIX} 原始 diff 总长度: ${diffToUse.length} 字符，拆分为 ${rawFileDiffs.length} 个文件块`,
      );

      // 对超长单文件 diff 截断，并控制总体积
      const fileDiffs: string[] = [];
      let totalDiffLength = 0;
      let truncatedFileCount = 0;
      let perFileFileLengthLimitCount = 0;
      for (const d of rawFileDiffs) {
        const name = this._extractFilenameFromDiffBlock(d);
        if (d.length > MAX_FILE_DIFF_LENGTH) {
          perFileFileLengthLimitCount++;
          this._log(
            `${LOG_PREFIX} 单文件截断: ${name || "未知文件"} 原始 ${d.length} 字符 → ${MAX_FILE_DIFF_LENGTH} 字符`,
          );
        }
        const capped =
          d.length > MAX_FILE_DIFF_LENGTH
            ? d.slice(0, MAX_FILE_DIFF_LENGTH) + "\n\n... (已截断)"
            : d;
        if (
          totalDiffLength + capped.length > MAX_TOTAL_DIFF_LENGTH &&
          fileDiffs.length > 0
        ) {
          truncatedFileCount++;
          this._log(
            `${LOG_PREFIX} 总量超限跳过: ${name || "未知文件"} 当前累计 ${totalDiffLength} 字符`,
          );
          continue;
        }
        totalDiffLength += capped.length;
        fileDiffs.push(capped);
      }

      this._log(
        `${LOG_PREFIX} 进入 AI 生成: ${fileDiffs.length} 个文件，截断后总长度 ${totalDiffLength} 字符（单文件截断 ${perFileFileLengthLimitCount} 个，总量跳过 ${truncatedFileCount} 个）`,
      );

      if (truncatedFileCount > 0 || perFileFileLengthLimitCount > 0) {
        this._view.webview.postMessage({
          command: "status",
          message: `已跳过 ${truncatedFileCount} 个文件（diff 过长），结果可能不完整`,
          type: "info",
        });
      }

      if (fileDiffs.length === 0) {
        if (rawFileDiffs.length === 0 && diffToUse.trim()) {
          throw new Error(
            "当前暂存区仅包含图片或二进制文件，无法生成 commit 信息，请提交文本代码文件后再试",
          );
        }
        throw new Error("AI 未返回有效 commit 条目");
      }

      const summaries: string[] = [];
      const signal = controller.signal;
      for (const fileDiff of fileDiffs) {
        if (!fileDiff.trim() || signal.aborted) {
          continue;
        }
        const prompt = this._buildFileSummaryPrompt(fileDiff);
        const text = await this._callAi(apiEndpoint, apiKey, model, apiProtocol, prompt, signal);
        if (text) {
          summaries.push(text);
        }
      }

      if (signal.aborted) {
        throw new Error("已取消生成");
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
        apiProtocol,
        finalPrompt,
        controller.signal,
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
        repoRoot: targetRoot,
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
      if (error?.name === "AbortError" || error?.message === "已取消生成") {
        this._view.webview.postMessage({
          command: "status",
          message: "已停止生成",
          type: "info",
        });
      } else {
        this._view.webview.postMessage({
          command: "error",
          error: error.message || "生成失败",
        });
      }
    } finally {
      if (targetRoot) {
        this._aiAbortControllers.delete(targetRoot);
        this._view.webview.postMessage({
          command: "generatingDone",
          repoRoot: targetRoot,
        });
      }
    }
  }

  /**
   * 停止正在进行的 AI 生成
   * 按仓库隔离：停止指定仓库的生成任务
   */
  public stopGenerateCommit(repoRoot?: string) {
    const controller = repoRoot
      ? this._aiAbortControllers.get(repoRoot)
      : this._aiAbortControllers.values().next().value;
    if (controller) {
      controller.abort();
      this._view?.webview.postMessage({
        command: "status",
        message: "正在停止生成...",
        type: "info",
      });
    }
  }

  /**
   * 调用 AI 接口，返回清洗后的文本
   * apiProtocol: "auto" | "openai" | "anthropic"
   *  - auto：按地址自动识别（路径含 /anthropic 视为 Anthropic 协议，否则视为 OpenAI 协议）
   *  - 显式指定 openai / anthropic 时直接生效；用于地址中不含 /anthropic 的 Anthropic 兼容端点
   *    （如 Kimi Code Anthropic 兼容端点 https://api.kimi.com/coding/）
   */
  private async _callAi(
    apiEndpoint: string,
    apiKey: string,
    model: string,
    apiProtocol: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const isAnthropic =
      apiProtocol === "anthropic" ||
      (apiProtocol !== "openai" && /\/anthropic/i.test(apiEndpoint));
    const url = isAnthropic
      ? this._buildAnthropicUrl(apiEndpoint)
      : this._buildOpenAiUrl(apiEndpoint);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (isAnthropic) {
      headers["anthropic-version"] = "2023-06-01";
      // Anthropic 原生鉴权头是 x-api-key；同时携带 Bearer 以兼容两类网关（如 Kimi Code 使用 Bearer）
      headers["x-api-key"] = apiKey;
    }
    const body: any = isAnthropic
      ? {
          model,
          max_tokens: 8192,
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
      signal,
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
   * 在对应仓库的 message 框中插入简化规范模板，供用户手动填写
   */
  private _insertTemplate(repoRoot?: string) {
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
    this._view.webview.postMessage({
      command: "templateInserted",
      template,
      repoRoot,
    });
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
      border: 1px solid var(--vscode-widget-border, transparent);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      transform: translateY(-6px);
      opacity: 0;
      transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
      /* notifications 系列变量在 Webview 中可能未定义，必须给出回退值，否则背景/文字色不可控 */
      background: var(--vscode-notifications-background, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)));
      color: var(--vscode-notifications-foreground, var(--vscode-foreground));
    }
    #statusToast.show { display: block; }
    #statusToast.in { transform: translateY(0); opacity: 1; }
    .status-success { border-left: 3px solid var(--vscode-testing-iconPassed, #3fb950); }
    .status-error { border-left: 3px solid var(--vscode-notificationsErrorIcon-foreground, var(--vscode-errorForeground, #f14c4c)); }
    .status-info { border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground, var(--vscode-focusBorder, #0078d4)); }

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
    .label-actions {
      position: relative;
      margin-left: auto;
      display: flex;
      align-items: center;
    }
    .more-btn {
      padding: 2px 6px;
      font-size: 14px;
      line-height: 1;
    }
    .more-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .more-dropdown {
      right: 0;
      min-width: 120px;
    }
    .dropdown-item.disabled {
      opacity: 0.35;
      cursor: not-allowed;
      pointer-events: none;
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
    .stat-chip.ctx .num { color: var(--vscode-symbolIcon-variableForeground, #75beff); }
    .stat-chip.ctx.warn {
      background: var(--vscode-editorWarning-background, rgba(194,150,41,0.12));
      border: 1px solid var(--vscode-editorWarning-border, rgba(194,150,41,0.3));
    }
    .stat-chip.ctx.warn .num { color: var(--vscode-editorWarning-foreground, #c29629); }
    .stat-chip.ctx.danger {
      background: var(--vscode-editorError-background, rgba(218,54,51,0.12));
      border: 1px solid var(--vscode-editorError-border, rgba(218,54,51,0.3));
    }
    .stat-chip.ctx.danger .num { color: var(--vscode-editorError-foreground, #f14c4c); }

    /* ===== 更改区 ===== */
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
    .section-header:hover .section-actions,
    .sub-header:hover .section-actions { opacity: 1; }
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

    /* ===== 仓库分组（多仓库/子模块场景，每个仓库一组） ===== */
    .repo-name { font-size: 12px; font-weight: 600; }
    .repo-icon { margin-right: 4px; font-size: 12px; line-height: 1; }
    .repo-body.collapsed { display: none; }
    .sub-header {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 12px 2px 22px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
      color: var(--vscode-descriptionForeground);
    }
    .sub-header.conflict-header {
      color: var(--vscode-gitDecoration-conflictingResourceForeground, #e2a05c);
    }

    /* ===== 仓库内提交区（每个仓库独立的消息框与操作按钮） ===== */
    .repo-commit-area { padding: 8px 12px 6px; }
    .repo-message { min-height: 90px; max-height: 50vh; }

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
    .file-item.conflict {
      background: var(--vscode-mergeEditor-conflict-input1-background, rgba(226,160,92,0.08));
    }
    .file-item.conflict:hover {
      background: var(--vscode-list-hoverBackground);
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
      <div class="stat-chip ctx" id="aiContextChip" title="暂存区 diff 字符数，帮助判断 AI 上下文是否过大"><span class="num" id="statCtx">0</span><span class="lbl">AI 上下文</span></div>
    </div>
  </div>

  <!-- 按仓库分组的变更列表（多仓库/子模块场景：每个仓库一张卡片，独立消息框与提交按钮） -->
  <div id="repoGroups">
    <div class="empty-state"><span class="glyph">◌</span>暂无变更</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // 每个仓库独立的状态：消息文本 / 是否正在生成 / 是否折叠（跨刷新保留）
    const repoState = {};

    const els = {
      toast: document.getElementById('statusToast'),
      statFiles: document.getElementById('statFiles'),
      statAdd: document.getElementById('statAdd'),
      statDel: document.getElementById('statDel'),
      statCtx: document.getElementById('statCtx'),
      aiContextChip: document.getElementById('aiContextChip'),
      repoGroups: document.getElementById('repoGroups'),
    };

    function getRepoState(root) {
      if (!repoState[root]) {
        repoState[root] = { message: '', generating: false, collapsed: false };
      }
      return repoState[root];
    }

    function findRepoSection(root) {
      const secs = els.repoGroups.querySelectorAll('.repo-group');
      for (const sec of secs) {
        if (sec.dataset.repoRoot === root) {
          return sec;
        }
      }
      return null;
    }

    function firstRepoRoot() {
      const sec = els.repoGroups.querySelector('.repo-group');
      return sec ? sec.dataset.repoRoot : null;
    }

    // 设置指定仓库的消息文本并联动 UI（repoRoot 缺省时取第一个仓库）
    function setRepoMessage(root, text) {
      const target = root || firstRepoRoot();
      if (!target) { return; }
      const st = getRepoState(target);
      st.message = text;
      const sec = findRepoSection(target);
      if (!sec) { return; }
      const ta = sec.querySelector('.repo-message');
      ta.value = text;
      ta.dispatchEvent(new Event('input'));
    }

    // 更新指定仓库的 AI 生成按钮状态（生成中 → 按钮变为"停止生成"）
    function setRepoGenerating(root, generating) {
      const target = root || firstRepoRoot();
      if (!target) { return; }
      const st = getRepoState(target);
      st.generating = generating;
      const sec = findRepoSection(target);
      if (!sec) { return; }
      const btn = sec.querySelector('.btn-generate');
      btn.innerHTML = generating ? '⏹ 停止生成' : '✦ AI 生成 Commit';
    }

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

    function renderFileList(container, files, emptyText) {
      if (!files || files.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="glyph">◌</span>' + escapeHtml(emptyText) + '</div>';
        return;
      }

      const html = files.map((file, index) => {
        const statusColor = file.statusColor || 'var(--vscode-foreground)';
        const isConflict = Boolean(file.isConflict);
        const isStaged = file.isStaged;
        const actionIcon = isStaged ? '−' : '+';
        const actionTitle = isStaged ? '取消暂存' : '暂存';
        const actionCommand = isStaged ? 'unstageFile' : 'stageFile';

        const isDeleted = !isConflict && file.statusLetter === 'D';
        const conflictIcon = isConflict ? '<span class="file-image-icon" title="合并冲突">⚠</span>' : '';
        const imageIcon = file.isImage ? '<span class="file-image-icon" title="图片">🖼</span>' : '';
        const conflictActions = isConflict
          ? '<button class="file-action-btn" title="打开合并编辑器" data-cmd="openMergeEditor">⇄</button>' +
            '<button class="file-action-btn" title="采用当前更改（ours）" data-cmd="resolveConflict" data-strategy="ours">◀</button>' +
            '<button class="file-action-btn" title="采用传入更改（theirs）" data-cmd="resolveConflict" data-strategy="theirs">▶</button>' +
            '<button class="file-action-btn" title="标记为已解决（暂存）" data-cmd="resolveConflict" data-strategy="manual">✓</button>'
          : '<button class="file-action-btn" title="' + actionTitle + '" data-cmd="' + actionCommand + '"' + (isDeleted ? ' disabled' : '') + '>' + actionIcon + '</button>' +
            (isDeleted ? '' : '<button class="file-action-btn" title="放弃更改" data-cmd="discardFile">↺</button>');

        return '<div class="file-item' + (isDeleted ? ' deleted' : '') + (isConflict ? ' conflict' : '') + '" data-index="' + index + '" data-path="' + escapeHtml(file.fullPath) + '"' +
          (file.originalFullPath ? ' data-original-path="' + escapeHtml(file.originalFullPath) + '"' : '') +
          '>' +
          '<div class="file-status" style="color:' + statusColor + '">' + file.statusLetter + '</div>' +
          '<div class="file-info">' +
            conflictIcon +
            imageIcon +
            '<span class="file-name">' + escapeHtml(file.filename) + '</span>' +
            (file.dir ? '<span class="file-dir">' + escapeHtml(file.dir) + '</span>' : '') +
          '</div>' +
          '<div class="file-actions">' +
            conflictActions +
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
          if (file.isConflict) {
            vscode.postMessage({ command: 'openMergeEditor', filepath, status: file.status });
            return;
          }
          vscode.postMessage({ command: 'openFile', filepath, status: file.status, originalFilepath });
        });
      });

      container.querySelectorAll('.file-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.file-item');
          const filepath = item.dataset.path;
          const file = files[item.dataset.index];
          vscode.postMessage({ command: btn.dataset.cmd, filepath, status: file.status, strategy: btn.dataset.strategy });
        });
      });
    }

    // 渲染变更列表（按仓库分组：多仓库/子模块场景每个仓库一组，各自带暂存的更改/更改与操作按钮）
    function renderChanges(payload) {
      const changes = payload.changes || { conflicts: [], staged: [], unstaged: [] };
      const groups = payload.groups || changes.groups || [];
      const conflicts = changes.conflicts || [];
      const staged = changes.staged || [];
      const unstaged = changes.unstaged || [];
      const totalFiles = conflicts.length + staged.length + unstaged.length;

      els.statFiles.textContent = totalFiles;
      els.statAdd.textContent = '+' + (payload.additions || 0);
      els.statDel.textContent = '−' + (payload.deletions || 0);

      // 更新 AI 上下文大小：暂存区 diff 字符数，帮助判断提交是否过长
      const ctxChars = payload.aiContextChars || 0;
      els.statCtx.textContent = ctxChars >= 10000 ? (ctxChars / 1000).toFixed(1) + 'k' : String(ctxChars);
      if (els.aiContextChip) {
        els.aiContextChip.classList.remove('warn', 'danger');
        if (ctxChars > 20000) {
          els.aiContextChip.classList.add('danger');
        } else if (ctxChars > 8000) {
          els.aiContextChip.classList.add('warn');
        }
      }

      if (payload.loading) {
        els.repoGroups.innerHTML = '<div class="loading"><div class="spinner"></div>正在扫描 Git 变更...</div>';
        return;
      }

      renderRepoGroups(groups);
    }

    // 按仓库分组渲染：每个仓库一张卡片，包含独立的暂存的更改/更改列表、消息框、AI 生成与提交按钮
    function renderRepoGroups(groups) {
      // 保存当前滚动位置，重渲染后恢复，避免列表闪烁/跳动
      const savedScrollTop = els.repoGroups.scrollTop;

      // 渲染前先保存当前各仓库的输入，避免自动刷新后丢失
      els.repoGroups.querySelectorAll('.repo-group').forEach(sec => {
        const root = sec.dataset.repoRoot;
        const ta = sec.querySelector('.repo-message');
        if (root && ta) {
          getRepoState(root).message = ta.value;
        }
      });

      els.repoGroups.innerHTML = '';
      if (!groups || groups.length === 0) {
        els.repoGroups.innerHTML = '<div class="empty-state"><span class="glyph">◌</span>暂无变更</div>';
        els.repoGroups.scrollTop = savedScrollTop;
        return;
      }

      // 多仓库场景：根路径最浅的仓库为主仓库，其余为子仓库（子模块/嵌套仓库）
      const isMultiRepo = groups.length > 1;
      const mainRepoRoot = isMultiRepo
        ? groups.reduce((min, g) => {
            const depth = (g.repoRoot.match(/[\\/]/g) || []).length;
            const minDepth = (min.repoRoot.match(/[\\/]/g) || []).length;
            return depth < minDepth ? g : min;
          }, groups[0]).repoRoot
        : null;

      groups.forEach((g) => {
        const conflictFiles = g.conflicts || [];
        const stagedFiles = g.staged || [];
        const unstagedFiles = g.unstaged || [];
        const total = conflictFiles.length + stagedFiles.length + unstagedFiles.length;
        const st = getRepoState(g.repoRoot);
        const isMainRepo = g.repoRoot === mainRepoRoot;
        const repoIcon = isMultiRepo ? (isMainRepo ? '🏠' : '📁') : '';
        const repoTitle = isMultiRepo ? (isMainRepo ? '主仓库' : '子仓库') : '';
        const behindCount = typeof g.behind === 'number' ? g.behind : 0;
        const needsSync = Boolean(g.needsSync) || behindCount > 0;
        const hasLocalChanges = stagedFiles.length + unstagedFiles.length > 0;
        const isPureSync = needsSync && !hasLocalChanges;
        const mainCommitMode = needsSync ? 'sync' : 'commit';
        const mainCommitText = isPureSync
          ? '⇅ 同步'
          : needsSync
            ? '⇅ Commit & Sync'
            : '✓ Commit';
        const mainCommitTitle = isPureSync
          ? '远端有 ' + behindCount + ' 个提交需要同步'
          : needsSync
            ? '远端有 ' + behindCount + ' 个提交需要同步，提交后同步'
            : '提交';

        const section = document.createElement('section');
        section.className = 'changes-section repo-group';
        section.dataset.repoRoot = g.repoRoot;
        // Source Control 风格：合并冲突单独置顶分组，解决前不允许提交
        const conflictSectionHtml = conflictFiles.length > 0
          ? '<div class="sub-header conflict-header">冲突<span class="change-count">' + conflictFiles.length + '</span></div>' +
            '<div class="file-list conflict-list"></div>'
          : '';
        // 暂存区为空时不显示“暂存的更改”区域，避免无效空区块占位
        const stagedSectionHtml = stagedFiles.length > 0
          ? '<div class="sub-header">暂存的更改<span class="change-count">' + stagedFiles.length + '</span>' +
              '<span class="section-actions">' +
                '<button class="section-action-btn" title="全部取消暂存" data-action="unstageAll" type="button">−</button>' +
              '</span>' +
            '</div>' +
            '<div class="file-list staged-list"></div>'
          : '';
        section.innerHTML =
          '<div class="section-header repo-header">' +
            '<span class="collapse-icon">▼</span>' +
            (repoIcon ? '<span class="repo-icon" title="' + repoTitle + '">' + repoIcon + '</span>' : '') +
            '<span class="repo-name">' + escapeHtml(g.repoName) + '</span>' +
            '<span class="change-count">' + total + '</span>' +
            '<span class="section-actions">' +
              '<button class="section-action-btn" title="刷新" data-action="refreshDiff" type="button">↻</button>' +
            '</span>' +
          '</div>' +
          '<div class="repo-body">' +
            conflictSectionHtml +
            stagedSectionHtml +
            '<div class="sub-header">更改<span class="change-count">' + unstagedFiles.length + '</span>' +
              '<span class="section-actions">' +
                '<button class="section-action-btn" title="全部暂存" data-action="stageAll" type="button">+</button>' +
              '</span>' +
            '</div>' +
            '<div class="file-list unstaged-list"></div>' +
            '<div class="repo-commit-area">' +
              '<textarea class="message-textarea repo-message" spellcheck="false" placeholder="点击「AI 生成」自动填充，或点击「模板」手动填写规范 commit..." aria-label="提交信息"></textarea>' +
              '<div class="message-meta">' +
                '<span><span class="char-count">0</span> 字符 · Ctrl+Enter 提交</span>' +
                '<div class="msg-tools">' +
                  '<button class="tool-btn btn-template" type="button">模板</button>' +
                  '<button class="tool-btn btn-clear" type="button">清空</button>' +
                '</div>' +
              '</div>' +
              '<div class="actions-row">' +
                '<button class="ai-btn btn-generate" type="button">✦ AI 生成 Commit</button>' +
                '<button class="copy-btn btn-copy" title="复制到剪贴板" type="button" aria-label="复制">⧉</button>' +
              '</div>' +
              '<div class="commit-actions">' +
                '<div class="commit-btn-group disabled">' +
                  '<button class="btn-commit-main" type="button" data-mode="' + mainCommitMode + '" title="' + escapeHtml(mainCommitTitle) + '" disabled>' + mainCommitText + '</button>' +
                  '<button class="btn-commit-dropdown" type="button" aria-label="更多提交选项">▼</button>' +
                '</div>' +
                '<div class="dropdown commit-dropdown">' +
                  '<div class="dropdown-item" data-mode="commit">✓ Commit</div>' +
                  '<div class="dropdown-item" data-mode="push">↑ Commit &amp; Push</div>' +
                  '<div class="dropdown-item" data-mode="sync">⇅ Commit &amp; Sync</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
        els.repoGroups.appendChild(section);

        if (conflictFiles.length > 0) {
          renderFileList(section.querySelector('.conflict-list'), conflictFiles, '暂无冲突');
        }
        if (stagedFiles.length > 0) {
          renderFileList(section.querySelector('.staged-list'), stagedFiles, '暂无已暂存变更');
        }
        renderFileList(section.querySelector('.unstaged-list'), unstagedFiles, '暂无变更\\n修改文件后将自动显示');

        const header = section.querySelector('.repo-header');
        const body = section.querySelector('.repo-body');
        const icon = section.querySelector('.collapse-icon');
        const ta = section.querySelector('.repo-message');
        const charCount = section.querySelector('.char-count');
        const commitGroup = section.querySelector('.commit-btn-group');
        const btnCommitMain = section.querySelector('.btn-commit-main');
        const btnDropdown = section.querySelector('.btn-commit-dropdown');
        const dropdown = section.querySelector('.commit-dropdown');
        const btnGenerate = section.querySelector('.btn-generate');

        function refreshCommitUI() {
          const hasText = ta.value.trim().length > 0;
          const hasConflict = conflictFiles.length > 0;
          const canCommit = !hasConflict && (hasText || isPureSync);
          btnCommitMain.disabled = !canCommit;
          btnCommitMain.dataset.mode = mainCommitMode;
          if (hasConflict) {
            btnCommitMain.textContent = '⚠ 解决冲突';
            btnCommitMain.title = '存在未解决的合并冲突，请先在“冲突”分组中处理';
          } else {
            btnCommitMain.textContent = mainCommitText;
            btnCommitMain.title = mainCommitTitle;
          }
          btnDropdown.disabled = !canCommit;
          commitGroup.classList.toggle('disabled', !canCommit);
          charCount.textContent = ta.value.length;
        }

        function autoResizeTa() {
          ta.style.height = 'auto';
          const h = Math.min(Math.max(ta.scrollHeight, 90), Math.round(window.innerHeight * 0.5));
          ta.style.height = h + 'px';
        }

        // 恢复跨刷新保留的状态（消息文本 / 折叠 / 生成中）
        ta.value = st.message;
        if (st.collapsed) {
          body.classList.add('collapsed');
          icon.classList.add('collapsed');
        }
        if (st.generating) {
          btnGenerate.innerHTML = '⏹ 停止生成';
        }
        refreshCommitUI();
        autoResizeTa();

        // 仓库分组折叠
        header.addEventListener('click', (e) => {
          if (e.target.closest('.section-actions')) { return; }
          st.collapsed = !st.collapsed;
          body.classList.toggle('collapsed', st.collapsed);
          icon.classList.toggle('collapsed', st.collapsed);
        });

        // 仓库级批量操作：暂存的更改区「全部取消暂存」、更改区「全部暂存」、组头「刷新」（只作用于该仓库）
        section.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: btn.dataset.action, repoRoot: g.repoRoot });
          });
        });

        // 消息输入
        ta.addEventListener('input', () => {
          st.message = ta.value;
          refreshCommitUI();
          autoResizeTa();
        });
        ta.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.key === 'Enter' && ta.value.trim() && !btnCommitMain.disabled) {
            vscode.postMessage({ command: 'commit', message: ta.value, mode: btnCommitMain.dataset.mode || 'commit', repoRoot: g.repoRoot });
          }
        });

        // AI 生成 / 停止（只基于该仓库的暂存区）
        btnGenerate.addEventListener('click', () => {
          if (st.generating) {
            vscode.postMessage({ command: 'stopGenerateCommit' });
            return;
          }
          vscode.postMessage({ command: 'generateCommit', repoRoot: g.repoRoot });
        });

        // 复制
        section.querySelector('.btn-copy').addEventListener('click', () => {
          if (ta.value.trim()) {
            vscode.postMessage({ command: 'copyCommit', commit: ta.value });
            showToast('已复制到剪贴板', 'success');
          }
        });

        // 模板 / 清空
        section.querySelector('.btn-template').addEventListener('click', () => {
          vscode.postMessage({ command: 'insertTemplate', repoRoot: g.repoRoot });
        });
        section.querySelector('.btn-clear').addEventListener('click', () => {
          ta.value = '';
          st.message = '';
          refreshCommitUI();
          autoResizeTa();
          ta.focus();
        });

        // 提交按钮组（只提交该仓库）
        btnCommitMain.addEventListener('click', () => {
          if (ta.value.trim() || btnCommitMain.dataset.mode === 'sync') {
            vscode.postMessage({ command: 'commit', message: ta.value, mode: btnCommitMain.dataset.mode || 'commit', repoRoot: g.repoRoot });
          }
        });
        btnDropdown.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!btnDropdown.disabled) {
            dropdown.classList.toggle('show');
          }
        });
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            dropdown.classList.remove('show');
            if (ta.value.trim() || item.dataset.mode === 'sync') {
              vscode.postMessage({ command: 'commit', message: ta.value, mode: item.dataset.mode, repoRoot: g.repoRoot });
            }
          });
        });
      });

      // 恢复之前保存的滚动位置
      els.repoGroups.scrollTop = savedScrollTop;
    }

    // ===== 全局事件 =====
    // 点击空白处关闭所有仓库的提交方式下拉菜单
    document.addEventListener('click', () => {
      els.repoGroups
        .querySelectorAll('.commit-dropdown.show')
        .forEach((d) => d.classList.remove('show'));
    });

    // 接收扩展消息
    window.addEventListener('message', function(event) {
      const message = event.data;

      if (message.command === 'commitGenerated') {
        setRepoMessage(message.repoRoot, (message.commit || '').trim());
        showToast('AI 生成完成', 'success');
      } else if (message.command === 'templateInserted') {
        setRepoMessage(message.repoRoot, message.template || '');
        showToast('已插入规范模板', 'info');
      } else if (message.command === 'error') {
        showToast(message.error, 'error');
      } else if (message.command === 'status') {
        showToast(message.message, message.type);
      } else if (message.command === 'clearMessage') {
        setRepoMessage(message.repoRoot, '');
      } else if (message.command === 'diffStats') {
        renderChanges(message);
      } else if (message.command === 'generatingStarted') {
        setRepoGenerating(message.repoRoot, true);
      } else if (message.command === 'generatingDone') {
        setRepoGenerating(message.repoRoot, false);
      } else if (message.command === 'triggerCopy') {
        // 命令面板触发复制：复制第一个非空的仓库消息
        for (const root in repoState) {
          if (repoState[root].message.trim()) {
            vscode.postMessage({ command: 'copyCommit', commit: repoState[root].message });
            showToast('已复制到剪贴板', 'success');
            break;
          }
        }
      }
    });

    // 初始化
    vscode.postMessage({ command: 'refreshDiff' });
  </script>
</body>
</html>`;
  }
}
