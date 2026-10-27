import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.CWL_UI_BASE_URL || 'http://127.0.0.1:8791';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Browser checks require a local preview');
const browser = await chromium.launch();
for (const width of [320, 390, 1440]) {
  const context = await browser.newContext({viewport:{width,height:900}, isMobile:width<700, hasTouch:width<700});
  const page = await context.newPage();
  await page.goto(origin + '/?demo=1&view=cwl');
  await page.waitForSelector('.cwl-score-help');
  for(const label of ['ATQ','DEF']) {
    const summary=page.locator('.cwl-inline-score').filter({hasText:label}).first();
    await (width < 700 ? summary.tap() : summary.click());
    const help=summary.locator('..').locator('.cwl-score-tooltip');
    assert.equal(await help.isVisible(),true);
    assert.match(await help.innerText(),/0 a 100/);
    const b=await help.boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= width, `${width} ${label} tooltip clipped`);
    await (width < 700 ? summary.tap() : summary.click());
  }
  await page.getByRole('tab',{name:'Ranking de mérito'}).click();
  assert.match(await page.locator('.cwl-policy-summary').innerText(),/dificuldade/);
  assert.match(await page.locator('.cwl-policy-summary').innerText(),/destruição e tempo/);
  console.log(`PASS ${width}: score help and ranking`);
  await context.close();
}
await browser.close();
