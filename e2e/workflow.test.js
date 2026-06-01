const { test, expect } = require('@playwright/test');

test.describe('WorkflowDiagram tab (Workflow)', () => {
  test('opens Workflow tab and renders 6 stage cards', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-workflow').click();

    const panel = page.locator('#tab-panel-workflow');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Pipeline header
    await expect(panel.getByText('A-Team Pipeline Workflow')).toBeVisible();

    // 6 stages: Strategy, Design, Build, Review, Test, Summary
    const stageTitles = ['Strategy', 'Design', 'Build', 'Review', 'Test', 'Summary'];
    for (const title of stageTitles) {
      await expect(panel.getByText(title, { exact: true })).toBeVisible();
    }
  });

  test('shows FLOW v4.1 cross-team handoff callout', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-workflow').click();
    const panel = page.locator('#tab-panel-workflow');
    await expect(panel).toBeVisible({ timeout: 10000 });

    await expect(panel.getByText(/FLOW v4.1/)).toBeVisible();
    await expect(panel.getByText(/Cross-team handoff logging/i)).toBeVisible();
  });

  test('shows team active indicators (a-team, DevInwTeam)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-workflow').click();
    const panel = page.locator('#tab-panel-workflow');
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Each team appears at least once (in indicator + in stage cards)
    await expect(panel.getByText(/a-team/).first()).toBeVisible();
    await expect(panel.getByText(/DevInwTeam/).first()).toBeVisible();
  });

  test('renders color legend with 6 entries', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-workflow').click();
    const panel = page.locator('#tab-panel-workflow');
    await expect(panel).toBeVisible({ timeout: 10000 });

    await expect(panel.getByText('Legend')).toBeVisible();
    const legendItems = [
      /Strategy \/ Acceptance/i,
      /Design \/ Dispatch/i,
      /Build \(parallel\)/i,
      /Review Gate/i,
      /Test \(QA\)/i,
      /Summary/i,
    ];
    for (const item of legendItems) {
      await expect(panel.getByText(item)).toBeVisible();
    }
  });
});
