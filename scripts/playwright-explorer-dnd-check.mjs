import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);

  const treeItems = page.locator('[data-testid="file-tree-item"]');
  const dragHandles = page.locator('[data-testid="file-tree-drag-handle"]');

  const itemCount = await treeItems.count();
  const handleCount = await dragHandles.count();

  console.log('[playwright] tree items:', itemCount);
  console.log('[playwright] drag handles:', handleCount);

  if (itemCount < 2 || handleCount < 1) {
    console.log('[playwright] Explorer state not ready for automated drag test. Open a project and explorer first.');
    process.exit(0);
  }

  const sourceHandle = dragHandles.first();
  const targetItem = treeItems.nth(1);

  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetItem.boundingBox();

  console.log('[playwright] sourceBox:', sourceBox);
  console.log('[playwright] targetBox:', targetBox);

  if (!sourceBox || !targetBox) {
    console.log('[playwright] Missing drag geometry.');
    process.exit(0);
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.move(targetBox.x + Math.min(24, targetBox.width / 3), targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(600);

  const logs = await page.evaluate(() => window.__lastExplorerDnDLogs || null);
  console.log('[playwright] drag attempt complete');
  if (logs) {
    console.log('[playwright] collected logs:', logs);
  }
} finally {
  await browser.close();
}
