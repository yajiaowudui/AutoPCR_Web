// Run against vite preview. All game/API actions are mocked.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const names = ['长任务', '警告号', '错误号', '重连号', '失联号'];
    const polls = new Map();
    const submissions = new Map();
    const finished = new Map();
    const result = (name, status = '成功') => ({ name, clan_forbid: false,
      daily_clean_time: { time: '2026-10-25', status, key: 'test', alias: name } });
    const job = (name, status = 'running', order = 'daily') => ({
      job_id: name, order, status, result: null, error: '', progress: '1/5 · 任务正在执行',
    });
    await page.addInitScript(() => {
      localStorage.setItem('readme2', 'true');
      localStorage.setItem('autopcr_popupResult', 'false');
      for (const name of ['长任务', '警告号', '错误号', '重连号', '失联号'])
        localStorage.setItem(`autopcr_popupResult_${name}`, 'false');
    });
    await page.route('**/daily/api/**', async route => {
      const request = route.request();
      const path = decodeURIComponent(new URL(request.url()).pathname);
      const json = data => route.fulfill({ json: data });
      const match = path.match(/\/account\/([^/]+)\/(.*)/);
      const name = match?.[1];
      const operation = match?.[2];
      if (operation === 'active_background_job') return route.fulfill({ status: 204 });
      if (operation === 'do_daily' || operation === 'do_single') {
        submissions.set(name, (submissions.get(name) || 0) + 1);
        polls.set(name, 0);
        return route.fulfill({ status: 202, json: job(name, 'running', operation === 'do_daily' ? 'daily' : 'user_info') });
      }
      if (operation?.startsWith('background_job/')) {
        const count = (polls.get(name) || 0) + 1;
        polls.set(name, count);
        if ((name === '重连号' && count <= 2) || (name === '失联号' && count <= 3))
          return route.fulfill({ status: 503, body: 'temporary unavailable' });
        if (name === '长任务' && submissions.get(name) === 1 && count < 7)
          return json({ ...job(name), progress: `${count}/7 · 等待耗时任务完成` });
        const status = name === '警告号' ? '警告' : name === '错误号' ? '错误' : '成功';
        finished.set(name, status);
        const single = name === '长任务' && submissions.get(name) > 1;
        return json({ ...job(name, 'completed', single ? 'user_info' : 'daily'),
          result: single ? [{ status: '成功' }, { status: '错误' }] : result(name, status),
          summary: `${status} 1 项`,
          progress: status === '警告' ? '刷图（警告）：体力不足' : status === '错误' ? '登录（错误）：游戏维护中' : '所有步骤执行完成',
        });
      }
      if (operation === 'daily') return json({ config: { user_info: true }, order: ['user_info'],
        info: { user_info: { key: 'user_info', name: '测试长任务', description: '', tags: [],
          implemented: true, runnable: true, config_order: [], config: {} } } });
      if (/\/account\/[^/]+$/.test(path)) return json({
        alias: path.split('/').pop(), username: 'demo', password: '********', channel: 'BSDK',
        area: [{ key: 'daily', name: '日常' }], batch_accounts: [], all_accounts: names,
      });
      if (path.endsWith('/query_validate')) return route.fulfill({
        contentType: 'text/event-stream', body: 'data: {"status":"ok"}\n\n',
      });
      if (path.endsWith('/running_status')) return json({ statuses: [] });
      if (path.endsWith('/role')) return json({ admin: false, super_user: false });
      if (path.endsWith('/daily_result')) return json([]);
      return json({ qq: '测试用户', accounts: names.map(name => result(name, finished.get(name) || '成功')), default_account: '' });
    });
    const base = process.env.TASK_PROGRESS_URL || 'http://127.0.0.1:5179';
    await page.goto(`${base}/daily/account/`);
    await page.getByRole('button', { name: '清理全部日常', exact: true }).click();
    const panel = page.getByRole('region', { name: '任务进度' });
    await panel.getByText('执行中 5', { exact: true }).waitFor();
    await panel.getByText('任务结束，含警告或中止，展开查看说明').waitFor({ timeout: 12000 });
    await panel.getByRole('button').filter({ hasText: '警告号 · 清日常' }).click();
    await panel.getByTestId('task-log').filter({ hasText: '体力不足' }).waitFor();
    await panel.getByRole('button').filter({ hasText: '错误号 · 清日常' }).click();
    await panel.getByTestId('task-log').filter({ hasText: '游戏维护中' }).waitFor();
    await panel.getByText('执行中 1 · 完成 1 · 警告 1 · 出错 1 · 待确认 1', { exact: true }).waitFor({ timeout: 25000 });
    // 跨过原来的 30 秒上限，长任务仍然保留执行状态。
    await page.waitForTimeout(16500);
    assert.match(await panel.getByRole('button').filter({ hasText: '长任务 · 清日常' }).innerText(), /执行中/);
    assert.equal(await page.getByText('操作失败', { exact: true }).count(), 0);
    assert.equal(await page.getByText(/timeout of 30000ms/).count(), 0);
    await panel.getByText('完成 2 · 警告 1 · 出错 1 · 待确认 1', { exact: true }).waitFor({ timeout: 12000 });
    for (const name of names) assert.equal(submissions.get(name), 1, `${name} must be submitted only once`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const box = await panel.boundingBox();
    if (process.env.TASK_PROGRESS_SCREENSHOT) await page.screenshot({ path: process.env.TASK_PROGRESS_SCREENSHOT });
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `panel must fit mobile viewport: ${JSON.stringify(box)}`);
    await panel.getByRole('button', { name: '清除已结束任务' }).click();
    await panel.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/daily/account/失联号`);
    await page.getByRole('button', { name: '清理全部日常', exact: true }).click();
    await panel.getByText('完成 1', { exact: true }).waitFor();
    assert.equal(submissions.get('失联号'), 1, 'resume must retrieve the stored job, even if it finished while disconnected');
    await panel.getByRole('button', { name: '清除已结束任务' }).click();
    await page.goto(`${base}/daily/account/长任务`);
    await page.getByRole('heading', { name: '测试长任务', exact: true }).click();
    await page.getByRole('button', { name: '执行', exact: true }).click();
    await panel.getByText('完成 1', { exact: true }).waitFor({ timeout: 12000 });
    assert.equal(await panel.getByText(/任务结束，部分步骤出错/).count(), 0, 'historical errors must not change current success');
    assert.deepEqual(errors, []);
    console.log('PASS: batch progress, >30s execution, warnings/errors, reconnect, unknown status, no duplicate submissions/toasts, mobile layout, single-task history');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
