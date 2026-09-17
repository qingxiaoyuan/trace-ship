import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { highlightKeywords, parseKeywords } from './highlight';

afterEach(cleanup);

describe('parseKeywords', () => {
  it('按换行与中英文逗号、分号拆分并去空白', () => {
    expect(parseKeywords('修复, 优化，性能\n安全;稳定；')).toEqual([
      '修复',
      '优化',
      '性能',
      '安全',
      '稳定',
    ]);
  });

  it('空输入返回空数组', () => {
    expect(parseKeywords()).toEqual([]);
    expect(parseKeywords('  \n ')).toEqual([]);
  });
});

describe('highlightKeywords', () => {
  it('无关键字或无命中时原样返回字符串', () => {
    expect(highlightKeywords('普通文本', [])).toBe('普通文本');
    expect(highlightKeywords('普通文本', ['不存在'])).toBe('普通文本');
    expect(highlightKeywords('', ['关键字'])).toBe('');
  });

  it('命中的关键字被 <mark> 包裹且不区分大小写', () => {
    const { container } = render(<div>{highlightKeywords('Fix BUG and fix docs', ['fix'])}</div>);

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('Fix');
    expect(marks[1].textContent).toBe('fix');
    expect(container.textContent).toBe('Fix BUG and fix docs');
  });

  it('关键字中的正则特殊字符按字面量匹配', () => {
    const { container } = render(<div>{highlightKeywords('价格 a.b 与 aXb', ['a.b'])}</div>);

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('a.b');
  });

  it('渲染完整文本内容不变', () => {
    render(<div>{highlightKeywords('发布包含新功能与修复', ['新功能', '修复'])}</div>);

    expect(screen.getByText('新功能').tagName).toBe('MARK');
    expect(screen.getByText('修复').tagName).toBe('MARK');
  });
});
