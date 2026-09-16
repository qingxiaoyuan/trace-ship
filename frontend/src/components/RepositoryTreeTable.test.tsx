import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RepositoryTreeTable, type RepositoryTreeGroup } from './RepositoryTreeTable';

interface TestItem {
  id: string;
  version: string;
}

const groups: RepositoryTreeGroup<TestItem>[] = [
  {
    id: 'repository-a',
    name: '仓库 A',
    description: 'group/repository-a',
    items: [{ id: 'version-a', version: 'VA.1.0.0' }],
  },
  {
    id: 'repository-b',
    name: '仓库 B',
    description: 'group/repository-b',
    items: [{ id: 'version-b', version: 'VB.2.0.0' }],
  },
];

afterEach(cleanup);

function renderTree() {
  return render(
    <RepositoryTreeTable
      groups={groups}
      columns={[]}
      getItemId={(item) => item.id}
      getItemSearchText={(item) => item.version}
      renderItemPrimary={(item) => item.version}
      renderMobileItem={(item) => item.version}
    />,
  );
}

describe('RepositoryTreeTable', () => {
  it('默认展开首个仓库，并支持搜索后自动展示命中版本', async () => {
    renderTree();

    expect((await screen.findAllByText('VA.1.0.0')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('VB.2.0.0')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText('搜索仓库或版本'), {
      target: { value: 'VB.2.0.0' },
    });

    expect(screen.getAllByText('VB.2.0.0').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('VA.1.0.0')).toHaveLength(0);
  });

  it('支持手动展开仓库和全部折叠', async () => {
    renderTree();

    await screen.findAllByText('VA.1.0.0');
    fireEvent.click(screen.getAllByRole('button', { name: /仓库 B/ })[0]);
    expect(screen.getAllByText('VB.2.0.0').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }));
    expect(screen.queryAllByText('VA.1.0.0')).toHaveLength(0);
    expect(screen.queryAllByText('VB.2.0.0')).toHaveLength(0);
  });
});
