import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar';

/**
 * 插件激活入口：注册侧边栏 Webview 视图与命令
 */
export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('规范提交助手');
  context.subscriptions.push(outputChannel);
  const sidebarProvider = new SidebarProvider(context.extensionUri, outputChannel);

  // 注册侧边栏 Webview 视图
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'commitView',
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 命令：生成规范 Commit
  context.subscriptions.push(
    vscode.commands.registerCommand('commit.generateCommit', async () => {
      await sidebarProvider.generateCommit();
    })
  );

  // 命令：复制 Commit 信息
  context.subscriptions.push(
    vscode.commands.registerCommand('commit.copyCommit', async () => {
      sidebarProvider.promptCopy();
    })
  );

  // 命令：刷新 Diff
  context.subscriptions.push(
    vscode.commands.registerCommand('commit.refreshDiff', async () => {
      await sidebarProvider.refreshDiff();
    })
  );
}

export function deactivate() {}
