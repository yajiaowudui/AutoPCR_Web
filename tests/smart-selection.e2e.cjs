// Run against a local preview with PLAYWRIGHT_MODULE pointing to Playwright when it is bundled externally.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_EXECUTABLE,
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const candidates = Array.from({ length: 30 }, (_, index) => ({
            value: 100001 + index, display: `角色${index + 1}`, nickname: `角色${index + 1}`, tags: [],
        }));
        const top = candidates.slice(10, 30).reverse().map(candidate => candidate.value);
        let config = { lazy_normal_sweep: true, lazy_sweep_consider_units: [100001], other: false, other_units: [] };
        const latestNormal = [11078006, 11078005, 11078004, 11078003, 11078002];
        const latestHard = [12078003, 12078002, 12078001, 12077003, 12077002];
        Object.assign(config, { last_normal_quest_sweep: false, last_hard_quest_sweep: false,
            last_normal_quest_auto_latest: true, last_hard_quest_auto_latest: true,
            last_normal_quests_sweep: latestNormal, last_hard_quests_sweep: latestHard });
        const writes = [];
        let smartRequests = 0;
        let failSelection = false;
        let pauseSelection = false;
        let releaseSelection;
        const moduleInfo = (key, name, configKey) => ({
            key, name, description: '', tags: [], implemented: true, runnable: false, text_result: false,
            config_order: [configKey],
            config: { [configKey]: { key: configKey, desc: '考虑角色', default: [], config_type: 'multi_search', candidates } },
        });
        const latestInfo = (kind, quests) => {
            const follow = `last_${kind}_quest_auto_latest`;
            const selected = `last_${kind}_quests_sweep`;
            return { key: `last_${kind}_quest_sweep`, name: kind === 'normal' ? '刷最新N图' : '刷最新H图',
                description: '默认自动跟随最新5关，关闭后可手动选图', tags: [], implemented: true, runnable: false,
                config_order: [follow, selected], config: {
                    [follow]: { key: follow, desc: '自动跟随最新5个关卡', default: true, config_type: 'bool', candidates: [] },
                    [selected]: { key: selected, desc: '刷取关卡', default: quests, config_type: 'multi',
                        candidates: quests.map(value => ({ value, display: `${Math.floor(value / 1000) % 1000}-${value % 1000}`, tags: [] })) },
                } };
        };
        await page.route('**/daily/api/**', async route => {
            const request = route.request();
            const path = decodeURIComponent(new URL(request.url()).pathname);
            const json = data => route.fulfill({ json: data });
            if (path.endsWith('/unit_selection/top_rank')) {
                smartRequests += 1;
                if (pauseSelection) {
                    await new Promise(resolve => { releaseSelection = resolve; });
                    return json([100001]);
                }
                if (failSelection) return route.fulfill({ status: 400, body: '读取练度失败' });
                return json(top);
            }
            if (path === '/daily/api/account/测试号/config') {
                assert.equal(request.method(), 'PUT');
                const update = request.postDataJSON();
                writes.push(update);
                config = { ...config, ...update };
                return json('保存配置成功');
            }
            if (path === '/daily/api/account/测试号/daily') return json({
                config, order: ['lazy_normal_sweep', 'last_normal_quest_sweep', 'last_hard_quest_sweep', 'other'],
                info: { lazy_normal_sweep: moduleInfo('lazy_normal_sweep', '懒人刷N图', 'lazy_sweep_consider_units'),
                        last_normal_quest_sweep: latestInfo('normal', latestNormal),
                        last_hard_quest_sweep: latestInfo('hard', latestHard),
                        other: moduleInfo('other', '其他选人配置', 'other_units') },
            });
            if (path === '/daily/api/account/测试号') return json({
                alias: '测试号', username: 'demo', password: '********', channel: 'BSDK', channel_option: ['BSDK'],
                area: [{ key: 'daily', name: '日常' }], batch_accounts: [], all_accounts: [],
            });
            if (path.endsWith('/query_validate')) return route.fulfill({
                contentType: 'text/event-stream', body: 'data: {"status":"ok"}\n\n',
            });
            if (path.endsWith('/running_status')) return json({ statuses: [] });
            if (path.endsWith('/role')) return json({ admin: false, super_user: false });
            return json({ accounts: [], default_account: '测试号' });
        });

        await page.goto(`${process.env.SMART_SELECTION_URL || 'http://127.0.0.1:5179'}/daily/account/测试号`);
        await page.getByRole('heading', { name: '懒人刷N图', exact: true }).click();
        const open = () => page.getByRole('button', { name: '选择', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        const smart = () => dialog.getByRole('button', { name: '智能选取最高品级20人', exact: true });
        const selectedCount = count => dialog.getByText(`已选择 (${count})`, { exact: true }).waitFor();

        await open();
        await smart().click();
        await selectedCount(20);
        assert.equal(writes.length, 0, 'smart selection must not save automatically');
        if (process.env.SMART_SELECTION_SCREENSHOT) {
            await page.screenshot({ path: process.env.SMART_SELECTION_SCREENSHOT, fullPage: true });
        }
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        await open();
        await selectedCount(1);
        await smart().click();
        await selectedCount(20);
        const saved = page.waitForResponse(response => decodeURIComponent(response.url()).endsWith('/account/测试号/config'));
        await dialog.getByRole('button', { name: '保存', exact: true }).click();
        await saved;
        assert.deepEqual(writes, [{ lazy_sweep_consider_units: top }]);

        failSelection = true;
        await open();
        await smart().click();
        await page.getByText('智能选取失败', { exact: true }).waitFor();
        await selectedCount(20);
        assert.equal(writes.length, 1);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();

        failSelection = false;
        pauseSelection = true;
        await open();
        await smart().click();
        while (!releaseSelection) await new Promise(resolve => setTimeout(resolve, 20));
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        await open();
        releaseSelection();
        await selectedCount(20);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(writes.length, 1, 'a late cancelled request must not save');

        await page.getByRole('heading', { name: '其他选人配置', exact: true }).click();
        await page.locator('#other').getByRole('button', { name: '选择', exact: true }).click();
        await dialog.getByText('已选择 (0)', { exact: true }).waitFor();
        assert.equal(await smart().count(), 0, 'other selectors must not show the new button');
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        for (const [kind, quests] of [['normal', latestNormal], ['hard', latestHard]]) {
            await page.getByRole('heading', { name: kind === 'normal' ? '刷最新N图' : '刷最新H图', exact: true }).click();
            const card = page.locator(`#last_${kind}_quest_sweep`);
            const toggle = card.locator('label[data-scope="switch"][data-part="root"]');
            const checkboxes = quests.map(quest => card.locator(`input[type="checkbox"][value="${quest}"]`));
            for (const checkbox of checkboxes) {
                assert.equal(await checkbox.isChecked(), true);
                assert.equal(await checkbox.isDisabled(), true);
            }
            const toggleFollow = async () => {
                const savedFollow = page.waitForResponse(response => decodeURIComponent(response.url()).endsWith('/account/测试号/config'));
                await toggle.click();
                await savedFollow;
            };
            await toggleFollow();
            assert.deepEqual(writes.at(-1), { [`last_${kind}_quests_sweep`]: quests, [`last_${kind}_quest_auto_latest`]: false });
            assert.equal(await checkboxes[0].isDisabled(), false);
            const savedManual = page.waitForResponse(response => decodeURIComponent(response.url()).endsWith('/account/测试号/config'));
            await card.getByText(`${Math.floor(quests[0] / 1000) % 1000}-${quests[0] % 1000}`, { exact: true }).click();
            await savedManual;
            assert.deepEqual(config[`last_${kind}_quests_sweep`], quests.slice(1));
            await toggleFollow();
            for (const checkbox of checkboxes) assert.equal(await checkbox.isChecked(), true);
            await toggleFollow();
            assert.equal(await checkboxes[0].isChecked(), false, 'manual subset must survive switching follow on and off');
            assert.equal(await checkboxes[0].isDisabled(), false);
        }
        if (process.env.LATEST_QUEST_SCREENSHOT) await page.screenshot({ path: process.env.LATEST_QUEST_SCREENSHOT, fullPage: true });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, smartRequests, configWrites: writes.length }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
