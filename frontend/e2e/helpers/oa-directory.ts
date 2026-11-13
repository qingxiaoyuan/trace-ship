import { expect, type Page } from '@playwright/test';

export async function openArchiveDirectoryPicker(page: Page) {
  await page.getByRole('button', { name: '发起 OA 归档', exact: true }).click();
  const choice = page.getByRole('combobox', { name: '归档目录', exact: true });
  await expect(choice).toBeEnabled();
  await choice.click();
}

export async function searchArchiveDirectory(page: Page, taskName: string) {
  await page.getByRole('combobox', { name: '归档目录', exact: true }).fill(taskName);
  const option = page.getByRole('option').filter({ has: page.getByText(taskName, { exact: true }) });
  await expect(option).toHaveCount(1);
  return option;
}
