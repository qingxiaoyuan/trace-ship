import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { workflowApi } from '@/api/workflow';
import { AiReviewReport } from './AiReviewReport';
import { useAuthStore } from '@/stores/authStore';

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><AiReviewReport instanceId="round-one" /></MemoryRouter>
  </QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAuthStore.getState().clearAuth(); });

it('展示完整报告、覆盖和意见并安全呈现模型文本', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai-1', status: 'completed',
    summary: '已完成审查', dimensions: ['安全'], coverage: { total_files: 2, reviewed_files: 2, warnings: [] },
    findings: [{ severity: 'P1', title: '错误处理', reason: '<script>alert(1)</script>尾部', suggestion: '检查返回值', path: 'src/a.ts', side: 'new', line_start: 2, line_end: 3 }] }] });
  const { container } = show();
  expect(await screen.findByText('已完成审查')).toBeTruthy();
  expect(screen.getByText('覆盖范围：2 / 2 个文件')).toBeTruthy();
  expect(screen.getByText('P1')).toBeTruthy();
  expect(screen.getByText(/尾部/).textContent).toContain('<script>alert(1)</script>尾部');
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('src/a.ts · 新侧 2–3 行')).toBeTruthy();
});

it('摘要权限不显示完整报告，首发跳过与失败分别展示', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [
    { node_id: 'first', node_name: '首次审查', status: 'first_release', summary: '首次发布', coverage: { total_files: 0, reviewed_files: 0, warnings: [] } },
    { node_id: 'failed', status: 'failed', summary: '模型服务不可用', coverage: { total_files: 2, reviewed_files: 0, warnings: ['尚未审查'] } },
  ] });
  show();
  expect(await screen.findByText('首次审查 · 首次发布，跳过 AI 审查')).toBeTruthy();
  expect(screen.getByText('审查失败')).toBeTruthy();
  expect(screen.getByText('尚未审查')).toBeTruthy();
  expect(screen.queryByText('审查意见')).toBeNull();
  expect(screen.queryByText('已审查文件')).toBeNull();
  expect(screen.queryByText('未审查文件')).toBeNull();
});

it('读取失败提供重试，不伪装成无报告', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockRejectedValue({ status: 500, friendlyMessage: '服务不可用' });
  show();
  expect((await screen.findByRole('alert')).textContent).toContain('服务不可用');
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});

it('审查运行时自动刷新并展示新结果', async () => {
  const coverage = { total_files: 1, reviewed_files: 0, warnings: [] };
  vi.spyOn(workflowApi, 'getAiReview')
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai', status: 'running', summary: '审查中', coverage }] })
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai', status: 'completed', summary: '审查已更新', coverage: { ...coverage, reviewed_files: 1 }, findings: [] }] });
  show();
  expect(await screen.findByText('正在审查')).toBeTruthy();
  expect(await screen.findByText('审查已更新', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('未报告意见，仍需人工判断。')).toBeTruthy();
});

it('排队时尚无覆盖统计也能显示状态', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: {} }] });
  show();
  expect(await screen.findByText('等待审查')).toBeTruthy();
  expect(screen.getByText('文件目录仅向有完整审查权限的人员展示。')).toBeTruthy();
});

it('第一个 AI 节点完成时即使后续 AI 仍排队也刷新流程', async () => {
  const coverage = { total_files: 1, reviewed_files: 0, warnings: [] };
  vi.spyOn(workflowApi, 'getAiReview')
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai-1', status: 'running', summary: '', coverage }, { node_id: 'ai-2', status: 'queued', summary: '', coverage }] })
    .mockResolvedValueOnce({ reviews: [{ node_id: 'ai-1', status: 'completed', summary: '首个审查完成', coverage }, { node_id: 'ai-2', status: 'queued', summary: '', coverage }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><MemoryRouter><AiReviewReport instanceId="round-one" /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('正在审查')).toBeTruthy();
  expect(await screen.findByText('首个审查完成', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('等待审查')).toBeTruthy();
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['workflow-instance-for-detail', 'round-one'] });
});

it('完整权限展示已审查和未审查文件，摘要权限不显示文件清单', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'incomplete', summary: '覆盖未完成',
    coverage: { total_files: 2, reviewed_files: 1, warnings: ['存在未覆盖文件'], reviewed_paths: ['src/checked.ts'], unreviewed_paths: ['src/missing.ts'] } }] });
  show();
  expect(await screen.findByText('src/checked.ts')).toBeTruthy();
  expect(screen.getByTitle('src/missing.ts')).toBeTruthy();
  expect(screen.getByText('missing.ts')).toBeTruthy();
  expect(screen.getByText('已审查文件')).toBeTruthy();
  expect(screen.getByText('未审查文件')).toBeTruthy();
});

it('审查正文保留 Markdown 语义并过滤危险 HTML 和链接', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'completed', summary: '', coverage: {},
    findings: [{ severity: 'P1', title: '问题', reason: '**重要** [文档](https://example.com) [危险](javascript:alert(1)) `<br>` <script>alert(1)</script>', suggestion: '核对配置' }] }] });
  const { container } = show();
  expect((await screen.findByText('重要')).tagName.toLowerCase()).toBe('strong');
  expect(screen.getByRole('link', { name: '文档' }).getAttribute('href')).toBe('https://example.com');
  expect(screen.getByText('危险').getAttribute('href')).not.toMatch(/^javascript:/);
  expect(screen.getByText('<br>').tagName.toLowerCase()).toBe('code');
  expect(container.querySelector('script')).toBeNull();
});

it('会话切换或权限收回后不会复用完整报告', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValueOnce({ reviews: [{ node_id: 'ai', status: 'completed',
    summary: '原账号私有报告', coverage: {}, findings: [] }] }).mockRejectedValue({ status: 404 });
  show();
  expect(await screen.findByText('原账号私有报告')).toBeTruthy();
  act(() => useAuthStore.getState().setTokens('another-account-token'));
  expect(screen.queryByText('原账号私有报告')).toBeNull();
  await waitFor(() => expect(screen.queryByLabelText('AI 代码审查')).toBeNull());
});

it('管理员留理由跳过并刷新状态，空理由不可提交', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'failed', summary: '失败', coverage: {}, can_recover: true }] });
  const skip = vi.spyOn(workflowApi, 'skipAiReview').mockResolvedValue(undefined);
  show();
  fireEvent.click(await screen.findByRole('button', { name: '留理由跳过' }));
  const submit = screen.getByRole('button', { name: '确认跳过并交人工审批' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('跳过原因'), { target: { value: ' 网络故障 ' } });
  fireEvent.click(submit);
  await waitFor(() => expect(skip).toHaveBeenCalledWith('round-one', 'ai', '网络故障'));
});

it('重试失败显示原因并允许再次操作', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'incomplete', summary: '未完成', coverage: {}, can_recover: true }] });
  const retry = vi.spyOn(workflowApi, 'retryAiReview').mockRejectedValue({ friendlyMessage: '状态已变化' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '重新审查' }));
  expect((await screen.findByRole('alert')).textContent).toContain('状态已变化');
  expect(retry).toHaveBeenCalledWith('round-one', 'ai');
  expect((screen.getByRole('button', { name: '重新审查' }) as HTMLButtonElement).disabled).toBe(false);
});

it('分批审查显示每批状态和文件覆盖', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'incomplete', summary: '审查未完成',
    coverage: { total_files: 2, reviewed_files: 1, reviewed_paths: ['first.py'], unreviewed_paths: ['second.py'],
      batches: [{ id: 'one', status: 'completed', paths: ['first.py'] }, { id: 'two', status: 'failed', paths: ['second.py'] }] } }] });
  show();
  expect(await screen.findByText('分批审查进度')).toBeTruthy();
  expect(screen.getByText('第 1 批：已完成')).toBeTruthy();
  expect(screen.getByText('第 2 批：失败')).toBeTruthy();
});

it('差异清单不完整时明确标注总数未知', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'incomplete', summary: '范围未完成',
    coverage: { manifest_complete: false, total_files: 2, reviewed_files: 2, warnings: ['远端差异范围不完整'] } }] });
  show();
  expect(await screen.findByText('覆盖范围：已知 2 / 2 个文件（完整清单未知）')).toBeTruthy();
});

it('历史执行保留独有意见，并按稳定 ID 避免重复显示', async () => {
  const shared = { id: 'shared', severity: 'P1', title: '相同意见', reason: '当前原因', suggestion: '修复' };
  const old = { id: 'old', severity: 'P2', title: '旧意见', reason: '**旧原因**', suggestion: '检查' };
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'completed', summary: '', coverage: {}, findings: [shared], history: [
    { token: 'one', status: 'failed', summary: '第一次', updated_at: '2026-10-28', findings: [shared, old] },
    { token: 'two', status: 'incomplete', summary: '第二次', updated_at: '2026-10-28', findings: [old] },
  ] }] });
  show();
  expect(await screen.findByText('过往审查执行（2）')).toBeTruthy();
  expect(screen.getAllByText('相同意见')).toHaveLength(1);
  expect(screen.getAllByText('旧意见')).toHaveLength(1);
  expect(screen.getByText('旧原因').tagName.toLowerCase()).toBe('strong');
});


it('已退回的旧轮明确显示未完成审查已取消', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'canceled', summary: '已取消', coverage: {} }] });
  show();
  expect(await screen.findByText('本轮审查已取消')).toBeTruthy();
});

it('完整审查报告提供当前轮整改采纳入口', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'completed', summary: '', coverage: {}, findings: [
    { id: 'f-1', severity: 'P1', title: '缺失边界', reason: '未校验', suggestion: '补校验' },
  ] }] });
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValue({ items: [], can_adopt: true });
  show();
  expect(await screen.findByRole('button', { name: '采纳：缺失边界' })).toBeTruthy();
});

it('当前轮没有 AI 节点时仍可查看并复核跨轮整改', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [] });
  vi.spyOn(workflowApi, 'getRemediations').mockResolvedValue({ can_adopt: false, items: [{
    id: 'item', instance_id: 'older', node_id: 'ai', finding_id: 'f',
    finding: { id: 'f', severity: 'P1', title: '遗留整改', reason: '需要修复', suggestion: '检查' },
    status: 'pending_review', fix_note: '已修复', history: [], can_fix: false, can_review: true,
  }] });
  show();
  expect(await screen.findByRole('button', { name: '确认已处理' })).toBeTruthy();
  expect(screen.getByText('遗留整改')).toBeTruthy();
});

it('长意见列表分页后可访问末尾', async () => {
  const findings = Array.from({ length: 21 }, (_, index) => ({ id: `f${index}`, severity: 'P2', title: `意见 ${index + 1}`, reason: '原因', suggestion: '修复' }));
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'completed', summary: '完成', coverage: {}, findings }] });
  show();
  expect(await screen.findByText('意见 1')).toBeTruthy();
  expect(screen.queryByText('意见 21')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '意见下一页' }));
  expect(screen.getByText('意见 21')).toBeTruthy();
});

it('完整报告展示本轮配置身份，摘要不展示配置', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [
    { node_id: 'ai', status: 'completed', summary: '', coverage: {}, configuration: {
      version_id: 'original-version', model: 'original-model', protocol: 'openai',
      skill: { name: 'code-review-expert', revision: 'old-revision', source: 'https://github.com/example/skill', license: 'MIT' },
    } },
    { node_id: 'limited', status: 'completed', summary: '', coverage: {} },
  ] });
  show();
  expect(await screen.findByText('本轮审查配置')).toBeTruthy();
  expect(screen.getByText('模型：original-model（openai）')).toBeTruthy();
  expect(screen.getByText('技能：code-review-expert · old-revision')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看技能来源' }).getAttribute('href')).toBe('https://github.com/example/skill');
  expect(screen.getAllByText('本轮审查配置')).toHaveLength(1);
});


it('等待审查时按固定差异展示文件目录，并保留重命名和末页文件', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: { total_files: 102, reviewed_files: 0 }, findings: [], history: [] }] });
  const files = Array.from({ length: 101 }, (_, index) => ({ old_path: `src/group/file-${index}.ts`, new_path: `src/group/file-${index}.ts`, diff: '' }));
  files.push({ old_path: 'old/name.ts', new_path: 'src/new-name.ts', diff: '', renamed_file: true } as typeof files[number]);
  const diff = vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status: 'ready', base_git_hash: 'a', head_git_hash: 'b', diffs: files });
  show();
  expect(await screen.findByText('待审查文件')).toBeTruthy();
  expect(await screen.findByText('file-0.ts')).toBeTruthy();
  expect(screen.getByText('src')).toBeTruthy();
  expect(screen.getByText('group')).toBeTruthy();
  expect(screen.queryByText('file-100.ts')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('file-100.ts')).toBeTruthy();
  expect(screen.getByText('new-name.ts')).toBeTruthy();
  expect(screen.getByText('（原路径：old/name.ts）')).toBeTruthy();
  expect(screen.queryByText('审查意见')).toBeNull();
  expect(diff).toHaveBeenCalledWith('round-one');
});

it('等待审查的摘要角色不请求文件目录，隐藏页签也不请求目录', async () => {
  const getDiff = vi.spyOn(workflowApi, 'getReviewDiff');
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: {} }] });
  const view = show();
  expect(await screen.findByText('文件目录仅向有完整审查权限的人员展示。')).toBeTruthy();
  expect(getDiff).not.toHaveBeenCalled();
  view.unmount();
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: {}, findings: [] }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AiReviewReport instanceId="round-two" active={false} /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('等待审查')).toBeTruthy();
  expect(getDiff).not.toHaveBeenCalled();
});

it('审查进行中只显示真实进度，不提前展示未完成意见', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'running', summary: '',
    coverage: { total_files: 3, reviewed_files: 1 }, findings: [{ severity: 'P1', title: '尚未完成的意见', reason: '原因', suggestion: '建议' }] }] });
  show();
  expect(await screen.findByText('正在审查')).toBeTruthy();
  expect(screen.getByText('已审查 1 / 3 个文件')).toBeTruthy();
  expect(screen.queryByText('尚未完成的意见')).toBeNull();
  expect(screen.queryByText('审查意见')).toBeNull();
});

it('审查失败时突出未审查目录和恢复入口，不把空结果当作审查完成', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'failed', summary: '模型输出被截断',
    coverage: { total_files: 1, reviewed_files: 0, unreviewed_paths: ['src/pay.ts'] }, findings: [], can_recover: true }] });
  show();
  expect(await screen.findByText('审查失败')).toBeTruthy();
  expect(screen.getByText('模型输出被截断')).toBeTruthy();
  expect(screen.getByTitle('src/pay.ts')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新审查' })).toBeTruthy();
  expect(screen.queryByText('审查意见')).toBeNull();
});

it('文件清单未完整取得时不把空目录当作无代码变更', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: {}, findings: [] }] });
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status: 'incomplete', base_git_hash: 'a', head_git_hash: 'b', diffs: [] });
  show();
  expect(await screen.findByText('尚未取得文件目录。')).toBeTruthy();
  expect(screen.getByText('以下仅为已取得的文件，完整范围尚未取得。')).toBeTruthy();
});

it.each([
  ['first_release', '首次发布没有基线，本轮将跳过 AI 代码审查，仍需人工审批。'],
  ['no_changes', '本轮没有代码变更，仍需人工审批。'],
] as const)('等待审查时区分 %s 和已审查文件', async (status, message) => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'queued', summary: '', coverage: {}, findings: [] }] });
  vi.spyOn(workflowApi, 'getReviewDiff').mockResolvedValue({ status, base_git_hash: '', head_git_hash: 'b', diffs: [] });
  show();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByText('没有未审查的文件。')).toBeNull();
});

it('审查失败且清单不完整时，空目录不代表没有未审查文件', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'failed', summary: '审查失败',
    coverage: { total_files: 0, reviewed_files: 0, unreviewed_paths: [], manifest_complete: false }, findings: [] }] });
  show();
  expect(await screen.findByText('尚未取得文件目录。')).toBeTruthy();
  expect(screen.getByText('以下仅为已取得的文件，完整范围尚未取得。')).toBeTruthy();
  expect(screen.queryByText('没有未审查的文件。')).toBeNull();
});

it('重新审查期间可查看过往执行记录', async () => {
  const finding = { id: 'same', severity: 'P1', title: '已完成批次的意见', reason: '历史原因', suggestion: '建议' };
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'running', summary: '',
    coverage: { total_files: 1, reviewed_files: 0 }, findings: [finding],
    history: [{ token: 'previous', status: 'failed', summary: '上次审查失败', updated_at: '2026-10-28T10:00:00Z', findings: [finding] }] }] });
  show();
  expect(await screen.findByText('审查进行中')).toBeTruthy();
  fireEvent.click(screen.getByText('过往审查记录'));
  expect(screen.getByText('上次审查失败')).toBeTruthy();
  expect(screen.getByText('已完成批次的意见')).toBeTruthy();
});


it('执行详情集中展示覆盖、批次、配置和历史，操作沿用项目按钮', async () => {
  vi.spyOn(workflowApi, 'getAiReview').mockResolvedValue({ reviews: [{ node_id: 'ai', status: 'failed', summary: '失败原因', can_recover: true,
    coverage: { total_files: 1, reviewed_files: 0, batches: [{ id: 'batch', status: 'failed', paths: ['src/a.ts'] }] },
    configuration: { version_id: 'v1', model: 'review-model', protocol: 'openai', skill: { name: 'review', revision: 'r1', source: '', license: '' } },
    history: [{ token: 'old', status: 'failed', summary: '上次未完成', updated_at: '2026-10-28T10:00:00Z' }] }] });
  show();
  const retry = await screen.findByRole('button', { name: '重新审查' });
  expect(retry.classList.contains('ant-btn')).toBe(true);
  expect(screen.getByRole('button', { name: '留理由跳过' }).classList.contains('ant-btn')).toBe(true);
  fireEvent.click(screen.getByText('执行详情'));
  expect(screen.getByText('覆盖情况')).toBeTruthy();
  expect(screen.getByText('分批审查进度')).toBeTruthy();
  expect(screen.getByText('本轮审查配置')).toBeTruthy();
  expect(screen.getByText('过往审查执行（1）')).toBeTruthy();
  fireEvent.click(screen.getByText('查看本批文件'));
  expect(screen.getByText('src/a.ts')).toBeTruthy();
});
