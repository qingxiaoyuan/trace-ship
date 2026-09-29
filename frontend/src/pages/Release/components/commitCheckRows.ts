import type { ParsedUpdate, PreviewCommit } from '@/types';

export interface CheckRow {
  hash: string;
  author: string;
  type: string;
  content: string;
  checked: boolean;
}

/** 已解析但超出自动填入上限的待勾选条目 */
export interface PendingRow {
  type: string;
  content: string;
  source: 'commit' | 'mr';
  sourceRef: string;
  checked: boolean;
  /** 用源数据定位，编辑内容后仍能对上同一条 */
  originKey: string;
}

export interface RowEdit {
  type: string;
  content: string;
  checked: boolean;
}

/** 提取 commit message 的第一行作为标题 */
function firstLine(message: string): string {
  return message.split('\n').find((line) => line.trim())?.trim() || message.slice(0, 80);
}

export function buildRows(commits: PreviewCommit[], existingRefs: Set<string>): CheckRow[] {
  return commits
    .filter((commit) => !commit.has_af)
    .filter((commit) => !existingRefs.has(`commit:${commit.hash.slice(0, 8)}`))
    .map((commit) => {
      const content = firstLine(commit.message);
      return {
        hash: commit.hash,
        author: commit.author,
        type: 'A',
        content,
        checked: false,
      };
    });
}

function pendingOriginKey(update: ParsedUpdate): string {
  const source = update.source || 'commit';
  const sourceRef = update.source_ref || '';
  const type = update.type || 'A';
  return `${source}:${sourceRef}:${type}:${(update.content || '').trim()}`;
}

export function buildPendingRows(pendingUpdates: ParsedUpdate[], existingContents: Set<string>): PendingRow[] {
  return pendingUpdates
    .filter((update) => !existingContents.has(`${update.type || 'A'}:${(update.content || '').trim()}`))
    .map((update) => ({
      type: update.type || 'A',
      content: update.content || '',
      source: update.source || 'commit',
      sourceRef: update.source_ref || '',
      checked: false,
      originKey: pendingOriginKey(update),
    }));
}

/** 未解析 Commit：去掉已加入和本地删除的行，再盖上未提交的编辑。 */
export function visibleCheckRows(
  built: CheckRow[],
  edits: Record<string, RowEdit>,
  removedHashes: ReadonlySet<string>,
): CheckRow[] {
  return built
    .filter((row) => !removedHashes.has(row.hash))
    .map((row) => {
      const edit = edits[row.hash];
      return edit ? { ...row, ...edit } : row;
    });
}

/** 已解析待选：源内容已加入的由 build 过滤；编辑后的内容若已加入也隐藏。 */
export function visiblePendingRows(
  built: PendingRow[],
  edits: Record<string, RowEdit>,
  existingContents: ReadonlySet<string>,
): PendingRow[] {
  return built
    .filter((row) => {
      const edit = edits[row.originKey];
      if (!edit) return true;
      const editedKey = `${edit.type}:${edit.content.trim()}`;
      const originKey = `${row.type}:${row.content.trim()}`;
      if (editedKey === originKey) return true;
      return !existingContents.has(editedKey);
    })
    .map((row) => {
      const edit = edits[row.originKey];
      return edit ? { ...row, ...edit } : row;
    });
}
