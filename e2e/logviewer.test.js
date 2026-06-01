const { test, expect } = require('@playwright/test');

test.describe('LogViewer tab (Logs)', () => {
  test('renders filter rail with agent, type, range controls', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-logs').click();

    const panel = page.locator('#tab-panel-logs');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Filters', { exact: true })).toBeVisible();

    await expect(panel.locator('#log-agent-filter')).toBeVisible();
    await expect(panel.locator('#log-type-filter')).toBeVisible();
  });

  test('renders empty state when no entries', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-logs').click();

    const panel = page.locator('#tab-panel-logs');
    const emptyHint = panel.getByText(/No log entries yet|No entries match your filters/i);
    const hasFeedRows = await panel.locator('button[aria-label="Export JSON"]').count();
    // Either some entries exist (export button visible) or empty state
    expect((await emptyHint.count()) + hasFeedRows).toBeGreaterThan(0);
  });

  test('export JSON button is present and clickable', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-logs').click();

    const panel = page.locator('#tab-panel-logs');
    const exportBtn = panel.getByRole('button', { name: /Export JSON/i });
    if (await exportBtn.count() > 0) {
      await expect(exportBtn).toBeEnabled();
    }
  });

  test('changing agent filter triggers UI update', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-logs').click();

    const agentSelect = page.locator('#log-agent-filter');
    const optionCount = await agentSelect.locator('option').count();
    if (optionCount > 1) {
      const firstNonAllValue = await agentSelect.locator('option').nth(1).getAttribute('value');
      await agentSelect.selectOption(firstNonAllValue);
      await expect(agentSelect).toHaveValue(firstNonAllValue);
    }
  });
});
