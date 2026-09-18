import { describe, expect, it } from 'vitest';
import { parseVisits } from './useRecentVisits';

describe('parseVisits', () => {
  it('空串或非法 JSON 返回空列表', () => {
    expect(parseVisits(null)).toEqual([]);
    expect(parseVisits('')).toEqual([]);
    expect(parseVisits('{')).toEqual([]);
    expect(parseVisits('{}')).toEqual([]);
  });

  it('过滤脏数据并按访问时间倒序', () => {
    const raw = JSON.stringify([
      { type: 'project', id: '1', title: '旧', path: '/projects/1', visitedAt: 100 },
      { type: 'unknown', id: 'x', title: '脏', path: '/x', visitedAt: 300 },
      { type: 'repository', id: '2', title: '新', path: '/repositories/2', visitedAt: 200 },
    ]);
    const visits = parseVisits(raw);
    expect(visits.map((item) => item.id)).toEqual(['2', '1']);
  });
});
