import { describe, expect, it } from 'vitest';
import { visibleCheckRows, visiblePendingRows } from './commitCheckRows';

describe('visibleCheckRows', () => {
  const built = [
    { hash: 'abc12345ffff', author: 'a', type: 'A', content: '原标题', checked: false },
    { hash: 'def67890ffff', author: 'b', type: 'A', content: '另一条', checked: false },
  ];

  it('已加入的条目不在候选里，未加入的编辑还在', () => {
    const rows = visibleCheckRows(
      built.slice(1),
      { def67890ffff: { type: 'F', content: '改过的内容', checked: true } },
      new Set(),
    );
    expect(rows).toEqual([
      { hash: 'def67890ffff', author: 'b', type: 'F', content: '改过的内容', checked: true },
    ]);
  });

  it('本地删除的行不会因为源列表还在而回来', () => {
    const rows = visibleCheckRows(built, {}, new Set(['abc12345ffff']));
    expect(rows.map((row) => row.hash)).toEqual(['def67890ffff']);
  });
});

describe('visiblePendingRows', () => {
  const built = [
    {
      type: 'A',
      content: '源内容',
      source: 'commit' as const,
      sourceRef: 'abc',
      checked: false,
      originKey: 'commit:abc:A:源内容',
    },
  ];

  it('编辑后的内容已经加入时隐藏，源内容未加入时保留编辑', () => {
    const kept = visiblePendingRows(
      built,
      { 'commit:abc:A:源内容': { type: 'A', content: '手改', checked: true } },
      new Set(['A:别的']),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toBe('手改');

    const hidden = visiblePendingRows(
      built,
      { 'commit:abc:A:源内容': { type: 'A', content: '手改', checked: true } },
      new Set(['A:手改']),
    );
    expect(hidden).toEqual([]);
  });
});
