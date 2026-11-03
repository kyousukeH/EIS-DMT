import { expect, test } from '@playwright/test';

test('dashboard renders operational status without overflow', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '迁移总览', exact: true })).toBeVisible();
  await expect(page.getByText('从这里开始迁移')).toHaveCount(0);
  await expect(page.getByText('当前磁盘复制')).toBeVisible();
  await expect(page.getByText('erp-wave-01').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByText('环境纳管')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByText('资产与规则')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByText('迁移作业')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByText(/^(01|02|03|04|05|06)$/)).toHaveCount(0);
  await expect(page.getByLabel('迁移准备流程').getByText('已完成', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('迁移准备流程').getByText('就绪度')).toHaveCount(0);
  const recentTasks = page.locator('section', { has: page.getByRole('heading', { name: '最近 6 个迁移任务' }) });
  await expect(recentTasks.getByText('按最近活动时间排序')).toBeVisible();
  await expect(recentTasks.locator('tbody tr').first()).toContainText('validation-pending');
  await expect(recentTasks.getByText('archive-wave-2026q2')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  if (testInfo.project.name === 'desktop') {
    const navigation = page.getByRole('navigation', { name: '主导航' });
    const iconNames = await navigation.locator('a svg').evaluateAll((icons) => icons.map((icon) =>
      Array.from(icon.classList).find((name) => name.startsWith('lucide-'))));
    expect(new Set(iconNames).size).toBe(iconNames.length);
    await page.getByTitle('收起导航').click();
    expect(await navigation.locator('.nav-flow-heading').evaluateAll((headings) => headings.every((heading) => getComputedStyle(heading).display === 'none'))).toBe(true);
    expect(await navigation.locator('svg:visible').evaluateAll((icons) => icons.every((icon) => Boolean(icon.closest('a'))))).toBe(true);
  }
});

test('migration detail exposes disk progress and failure reasons', async ({ page }, testInfo) => {
  await page.goto('/plans/erp-wave-01');
  await expect(page.getByRole('link', { name: '返回迁移任务' })).toHaveAttribute('href', '/plans');
  await expect(page.getByText('总体磁盘复制')).toBeVisible();
  await expect(page.getByText('失败阶段：适配虚拟机操作系统与目标驱动')).toBeVisible();
  await expect(page.getByText('任务配置', { exact: true })).toHaveCount(0);
  await expect(page.getByText('【可用磁盘空间不足】').first()).toBeVisible();
  await expect(page.getByText('【可用磁盘空间不足】')).toHaveCount(1);
  await expect(page.getByText('实时速率').first()).toBeVisible();
  await expect(page.getByText('预计剩余').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /失败 1/ })).toBeVisible();
  const rawDiskSpaceError = page.getByText('virt-v2v inspection failed: no space left on device', { exact: true });
  const diskSpaceFailure = page.locator('li.friendly-error').filter({ has: rawDiskSpaceError });
  await diskSpaceFailure.getByText('技术详情').click();
  await expect(rawDiskSpaceError).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(3);
  expect(await page.locator('.detail-meta .status-badge').evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
  expect(await page.locator('.task-row > span').first().evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
  await page.screenshot({ path: testInfo.outputPath('migration-detail.png'), fullPage: true });
});

test('plan wizard validates names and presents resource-aware settings', async ({ page }, testInfo) => {
  await page.goto('/plans/new');
  const nameInput = page.getByLabel('任务名称 *');
  await nameInput.fill('Invalid Plan_');
  await expect(nameInput).toHaveValue('Invalid Plan_');
  await expect(page.getByText('当前名称不符合规范')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await page.getByRole('button', { name: '生成合规标识符' }).click();
  await expect(nameInput).toHaveValue('invalid-plan');
  await nameInput.fill('erp-wave-01');
  await expect(page.getByText('已经存在同名迁移任务')).toBeVisible();
  await nameInput.fill('test-wave');
  await page.getByLabel('源端平台 *').selectOption('production-vcenter');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByText('erp-app-01').click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '迁移评估', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '目标网络', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '目标存储', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /任务专用配置/ })).toHaveCount(2);
  await expect(page.getByText('资源标识：network-21')).toBeVisible();
  await expect(page.getByText('关联虚拟机：erp-app-01').first()).toBeVisible();
  await expect(page.getByLabel('IP 配置 VM Network')).toHaveCount(0);
  await expect(page.getByText('默认集群网络的映射规则不填写 IP 配置')).toBeVisible();
  await expect(page.getByLabel('目标网络 VM Network').locator('option', { hasText: '手动指定业务网络' })).toHaveCount(1);
  await page.getByLabel('目标网络 VM Network').selectOption({ label: 'billing / billing-vlan-310（业务网络）' });
  await expect(page.getByLabel('目标网络 VM Network')).toHaveValue('billing/billing-vlan-310');
  await expect(page.getByLabel('IP 配置 VM Network')).toBeVisible();
  await expect(page.getByLabel('目标存储 vsan-prod')).toHaveValue('ocs-storagecluster-ceph-rbd');
  await page.getByLabel('目标存储 flash-tier').selectOption('ocs-storagecluster-cephfs');
  await page.getByLabel('磁盘呈现方式 flash-tier').selectOption('Filesystem');
  await page.getByLabel('磁盘使用方式 vsan-prod').selectOption('ReadWriteMany');
  await expect(page.getByLabel('磁盘使用方式 vsan-prod')).toHaveValue('ReadWriteMany');
  await page.getByRole('tab', { name: /选择已有配置/ }).first().click();
  await expect(page.getByLabel('搜索网络配置')).toBeVisible();
  await expect(page.locator('.wizard-selected-config').first().getByText('已选择')).toBeVisible();
  await page.getByRole('tab', { name: /任务专用配置/ }).first().click();
  await expect(page.getByText(/网络去向|存储去向/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('plan-mappings.png'), fullPage: true });
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '迁移选项', exact: true })).toBeVisible();
  await expect(page.getByText('适配目标环境的磁盘与网络驱动')).toBeVisible();
  await expect(page.getByText('检查磁盘空间、文件系统与操作系统')).toBeVisible();
  await expect(page.getByText('网络与安全设备镜像建议')).toBeVisible();
  await expect(page.getByText('conversion', { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toContainText('迁移选项');
  await expect(page.locator('[aria-current="step"]')).toBeInViewport();
  await page.getByText('检查磁盘空间、文件系统与操作系统').click();
  await expect(page.getByText('系统与磁盘检查已关闭')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plan-options.png'), fullPage: true });
});

test('default networks omit mapping IP mode while allowing plan-level static IP preservation', async ({ page }) => {
  await page.goto('/plans/new');
  await page.getByLabel('任务名称 *').fill('pod-network-safety');
  await page.getByLabel('源端平台 *').selectOption('production-vcenter');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.locator('.vm-row', { hasText: 'erp-app-01' }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('默认集群网络的映射规则不填写 IP 配置')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  const preserveStaticIP = page.getByLabel('保留静态 IP');
  await expect(preserveStaticIP).toBeEnabled();
  await expect(preserveStaticIP).toBeChecked();
  await expect(page.getByText('默认集群网络同样支持此选项')).toBeVisible();
});

test('existing mappings must cover every selected virtual machine resource', async ({ page }) => {
  await page.goto('/plans/new');
  await page.getByLabel('任务名称 *').fill('mapping-coverage-gate');
  await page.getByLabel('源端平台 *').selectOption('production-vcenter');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.locator('.vm-row', { hasText: 'legacy-tools-app' }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: '允许无 VMware Tools 继续迁移（1 台）' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('tab', { name: /选择已有配置/ }).first().click();
  await expect(page.getByText('已有网络配置缺少 1 条规则')).toBeVisible();
  await expect(page.getByText(/Isolated Network.*legacy-tools-app/)).toBeVisible();
  await page.getByRole('tab', { name: /选择已有配置/ }).nth(1).click();
  await expect(page.getByText('已有存储配置缺少 1 条规则')).toBeVisible();
  await expect(page.getByText(/archive-tier.*legacy-tools-app/)).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
});

test('critical virtual machines explain blockers and prevent continuing', async ({ page }, testInfo) => {
  await page.goto('/plans/new');
  await page.getByLabel('任务名称 *').fill('blocked-vm-check');
  await page.getByLabel('源端平台 *').selectOption('production-vcenter');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.locator('.vm-row', { hasText: 'erp-app-01' }).locator('input[type="checkbox"]').check();
  const vmRow = page.locator('.vm-row', { hasText: 'legacy-router' });
  await vmRow.locator('input[type="checkbox"]').check();
  await expect(page.getByText('当前迁移批次暂不可执行')).toBeVisible();
  await expect(page.getByText('其他 1 台虚拟机本身并未被标记为无法迁移', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await vmRow.locator('.risk-tooltip').focus();
  await expect(vmRow.getByRole('tooltip')).toBeVisible();
  await expect(vmRow.getByText('检测到不支持的磁盘控制器')).toBeVisible();
  await page.getByRole('button', { name: '移除阻塞虚拟机（共 1 台）' }).click();
  await expect(vmRow.locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('blocked-vm-tooltip.png'), fullPage: true });
});

test('vCenter tasks can skip VMware Tools validation per virtual machine', async ({ page }) => {
  await page.goto('/plans/new');
  await page.getByLabel('任务名称 *').fill('tools-compatibility');
  await page.getByLabel('源端平台 *').selectOption('production-vcenter');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  const toolsVM = page.locator('.vm-row', { hasText: 'legacy-tools-app' });
  await toolsVM.locator('input[type="checkbox"]').check();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await page.getByRole('button', { name: '允许无 VMware Tools 继续迁移（1 台）' }).click();
  await expect(toolsVM.getByText('已允许无 Tools 迁移')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('已允许无 VMware Tools 继续迁移', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '源端 VMware Tools 检查' })).toBeVisible();
  await expect(page.getByLabel('legacy-tools-app：未安装 VMware Tools 时仍允许迁移')).toBeChecked();
  await expect(page.getByText('开始冷迁移时将由 vCenter 直接关机', { exact: false })).toBeVisible();
});

test('migration tasks use the same newest-activity ordering as the overview', async ({ page }) => {
  await page.goto('/plans');
  await expect(page.locator('thead')).toContainText('最近活动');
  await expect(page.locator('tbody tr').first()).toContainText('validation-pending');

  await page.goto('/');
  await expect(page.locator('.content-grid tbody tr').first()).toContainText('validation-pending');
});

test('migration warnings use consistent language and explain their impact throughout the wizard', async ({ page }) => {
  await page.goto('/plans/new');
  await page.getByLabel('任务名称 *').fill('warning-language-check');
  await page.getByLabel('源端平台 *').selectOption('production-vcenter');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  const warningVm = page.locator('.vm-row', { hasText: 'erp-db-01' });
  await warningVm.locator('input[type="checkbox"]').check();
  await expect(warningVm.getByText('迁移警告', { exact: true })).toBeVisible();
  await expect(page.getByText(/需关注|需要关注/)).toHaveCount(0);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('erp-db-01 · 迁移警告：磁盘空间偏低')).toBeVisible();
  await expect(page.getByText('影响：不阻止创建和执行当前迁移方式，建议在迁移窗口前确认。')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled();
});

test('legacy plans have a stable type and wait for the current Ready condition', async ({ page }) => {
  await page.goto('/plans');
  const readyActions = page.locator('tr', { hasText: 'billing-wave-02' }).locator('.plan-row-actions');
  await expect(readyActions.getByRole('button', { name: '开始迁移' })).toBeVisible();
  await expect(readyActions.getByRole('link', { name: /编辑 billing-wave-02/ })).toBeVisible();
  await expect(readyActions.getByRole('button', { name: '删除' })).toBeVisible();
  await expect(readyActions.locator('.icon-button')).toHaveCount(0);
  const actionHeights = await readyActions.locator('.button').evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(Math.max(...actionHeights) - Math.min(...actionHeights)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: '归档任务' })).toHaveCount(0);
  const row = page.locator('tr', { hasText: 'validation-pending' });
  await expect(row.getByRole('link', { name: '查看详情' })).toBeVisible();
  await expect(row.locator('.type-badge')).toHaveText('冷迁移');
  await expect(row.getByRole('button', { name: '开始迁移' })).toHaveCount(0);

  await page.goto('/plans/validation-pending');
  await expect(page.getByText('冷迁移', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始迁移' })).toHaveCount(0);

  await page.goto('/plans/billing-wave-02');
  await expect(page.getByText('任务检查已恢复')).toBeVisible();
  await expect(page.getByText('源虚拟机存在快照，请先删除后重试。')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始迁移' })).toBeVisible();
});

test('plan statuses use distinct visual treatments', async ({ page }) => {
  await page.goto('/plans');
  const colors = await Promise.all([
    page.locator('tr', { hasText: 'billing-wave-02' }).locator('.status-badge').evaluate((element) => getComputedStyle(element).backgroundColor),
    page.locator('tr', { hasText: 'validation-pending' }).locator('.status-badge').evaluate((element) => getComputedStyle(element).backgroundColor),
    page.locator('tr', { hasText: 'archive-wave-2026q2' }).locator('.status-badge').evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(new Set(colors).size).toBe(3);
});

test('unstarted plans, providers, and mappings can be edited', async ({ page }, testInfo) => {
  await page.goto('/plans/billing-wave-02/edit');
  await expect(page.getByRole('heading', { level: 2, name: '编辑迁移任务', exact: true })).toBeVisible();
  await expect(page.getByLabel('任务名称 *')).toBeDisabled();
  await page.getByLabel('描述').fill('账务 Windows 工作负载（已调整）');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '仅保存任务' }).click();
  await expect(page).toHaveURL(/\/plans\/billing-wave-02$/);
  await expect(page.getByText('账务 Windows 工作负载（已调整）')).toBeVisible();

  await page.goto('/providers/sources');
  await expect(page.getByText('OpenShift Virtualization')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑 production-vcenter' })).toBeDisabled();
  await page.getByRole('button', { name: '编辑 legacy-openstack' }).click();
  const providerDialog = page.getByRole('dialog', { name: '编辑源集群连接' });
  await providerDialog.getByLabel('API 地址 *').fill('https://keystone-new.example/v3');
  await providerDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('https://keystone-new.example/v3')).toHaveText('https://keystone-new.example/v3');

  await page.goto('/mappings');
  await page.getByRole('button', { name: '存储配置' }).click();
  await expect(page.getByRole('button', { name: '编辑 ceph-block-default' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除 ceph-block-default' })).toBeDisabled();
  await expect(page.getByText('个任务尚未结束', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editable-resources.png'), fullPage: true });
});

test('warm migration supports immediate and scheduled business cutover with final transfer progress', async ({ page }, testInfo) => {
  await page.goto('/plans/warm-sync-01');
  await expect(page.getByText('温迁移', { exact: true })).toBeVisible();
  await expect(page.getByText('同步增量数据并关闭源虚拟机总进度')).toBeVisible();
  await expect(page.getByText('同步增量数据并关闭源虚拟机').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '业务割接中' })).toBeDisabled();
  await expect(page.getByText('源虚拟机已进入停机切换')).toBeVisible();

  await page.goto('/plans/warm-risk-gate');
  await page.getByRole('button', { name: '设置割接时间' }).click();
  let dialog = page.getByRole('dialog', { name: '设置割接时间' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '预约时间' }).click();
  await dialog.getByLabel('预约执行时间 *').fill('2099-12-31T23:30');
  await dialog.getByRole('button', { name: '保存割接安排' }).click();
  await expect(page.getByText('业务割接已安排')).toBeVisible();

  await page.getByRole('button', { name: '修改割接时间' }).click();
  await page.getByRole('dialog', { name: '修改割接时间' }).getByRole('button', { name: '取消预约' }).click();
  await expect(page.getByText('业务割接已安排')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '设置割接时间' })).toBeVisible();

  await page.getByRole('button', { name: '设置割接时间' }).click();
  dialog = page.getByRole('dialog', { name: '设置割接时间' });
  await dialog.getByLabel('已知晓非就绪割接风险').check();
  await dialog.getByRole('button', { name: '立即执行业务割接' }).click();
  await expect(page.getByRole('button', { name: '正在关闭源虚拟机' })).toBeDisabled();
  await expect(page.getByText('业务割接请求已受理')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('warm-cutover-progress.png'), fullPage: true });
});

test('business cutover blocks unsafe execution until risk is acknowledged', async ({ page }, testInfo) => {
  await page.goto('/plans/warm-risk-gate');
  await page.getByRole('button', { name: '设置割接时间' }).click();
  const dialog = page.getByRole('dialog', { name: '设置割接时间' });
  await expect(dialog.getByText('高危预警')).toBeVisible();
  await expect(dialog.getByText('当前最低进度：60%', { exact: false })).toBeVisible();
  const execute = dialog.getByRole('button', { name: '立即执行业务割接' });
  await expect(execute).toBeDisabled();
  await dialog.getByLabel('已知晓非就绪割接风险').check();
  await expect(execute).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('cutover-safety-gate.png'), fullPage: true });
});

test('failed migrations expose a confirmed rollback workflow', async ({ page }, testInfo) => {
  await page.goto('/plans/rollback-failed-01');
  await page.getByRole('button', { name: '一键回滚' }).click();
  const dialog = page.getByRole('dialog', { name: '确认一键回滚' });
  await expect(dialog.getByText('停止目标集群中仍在运行的数据导入与传输任务')).toBeVisible();
  await expect(dialog.getByText('清理本任务创建的目标虚拟机、目标磁盘和临时数据')).toBeVisible();
  const confirm = dialog.getByRole('button', { name: '确认回滚' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('我已确认回滚范围').check();
  await confirm.click();
  await expect(page.getByText('回滚请求已提交，目标资源正在后台清理。', { exact: false })).toBeVisible();
  await expect(page.getByText('回滚处理中', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('rollback-complete.png'), fullPage: true });
});

test('wizard maps selected VM resources directly and creates mappings on submit', async ({ page }, testInfo) => {
  const planName = `inline-flow-${testInfo.project.name}`;
  await page.goto('/plans/new');
  await page.getByLabel('任务名称 *').fill(planName);
  await page.getByLabel('源端平台 *').selectOption('legacy-openstack');
  await page.getByLabel('目标资源空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('erp-app-01').check();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByText('源端无需手动选择。')).toHaveCount(2);
  await expect(page.getByText('资源标识：network-21')).toBeVisible();
  await expect(page.getByText('资源标识：datastore-44')).toBeVisible();
  await page.getByLabel('目标网络 VM Network').selectOption({ label: 'billing / billing-vlan-310（业务网络）' });
  await page.getByLabel('目标存储 vsan-prod').selectOption('ocs-storagecluster-cephfs');

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText(`${planName}-network（任务专用）`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${planName}-storage（任务专用）`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '仅保存任务' })).toBeVisible();
  await page.getByRole('button', { name: '保存并立即开始迁移' }).click();
  await expect(page).toHaveURL(new RegExp(`/plans/${planName}$`));
  await expect(page.getByText('迁移中', { exact: true })).toBeVisible();
  await expect(page.getByText('迁移任务已提交，正在等待虚拟机进入执行队列。')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inline-mapping-started.png'), fullPage: true });
});

test('product UI uses compact controls and user-facing language', async ({ page }, testInfo) => {
  await page.goto('/providers/sources');
  await expect(page.locator('.brand strong')).toHaveText('EIS-DMT');
  await expect(page.getByText('演示模式')).toHaveCount(0);

  const search = page.locator('.search-box input');
  const paddingLeft = await search.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
  expect(paddingLeft).toBeGreaterThanOrEqual(36);
  await page.screenshot({ path: testInfo.outputPath('cluster-connections.png'), fullPage: true });

  await page.getByRole('button', { name: '连接源集群' }).click();
  const certificateCheckbox = page.getByRole('checkbox', { name: '跳过证书校验' });
  const checkboxBox = await certificateCheckbox.boundingBox();
  expect(checkboxBox?.width).toBeLessThanOrEqual(18);
  expect(checkboxBox?.height).toBeLessThanOrEqual(18);
  await page.screenshot({ path: testInfo.outputPath('provider-dialog.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await page.goto('/mappings');
  await page.getByRole('button', { name: '存储配置' }).click();
  await expect(page.getByText('Ceph Block 默认策略')).toHaveCount(0);

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '迁移兼容性检查', exact: true })).toBeVisible();
  await expect(page.getByText(/kubectl|feature_validation|Forklift|Cluster API|Mock API/)).toHaveCount(0);
  await expect(page.getByText('已开启', { exact: true })).toHaveCount(3);
  await expect(page.getByText('检查中', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
});

test('virtual machines can start a migration with provider and workload preselected', async ({ page }, testInfo) => {
  await page.goto('/vms/source?provider=production-vcenter');
  await expect(page.getByRole('heading', { level: 2, name: '源端虚拟机', exact: true })).toBeVisible();
  await expect(page.getByText('虚拟机资源', { exact: true })).toHaveCount(0);
  await expect(page.getByText('迁移警告', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('不会阻止创建任务')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText('production-vcenter', { exact: true }).first()).toBeVisible();
  const toolsRow = page.locator('tr', { hasText: 'legacy-tools-app' });
  await expect(toolsRow.getByText('可跳过工具检查')).toBeVisible();
  await expect(toolsRow.getByText('创建任务时可允许继续迁移')).toBeVisible();
  const vmRow = page.locator('tr', { hasText: 'erp-app-01' });
  await expect(vmRow.getByText('运行中')).toBeVisible();
  await vmRow.getByRole('link', { name: '创建迁移任务', exact: true }).click();

  await expect(page).toHaveURL(/\/plans\/new\?provider=production-vcenter&vm=vm-101/);
  await expect(page.getByLabel('源端平台 *')).toHaveValue('production-vcenter');
  await expect(page.getByText('已从资源列表选择 1 台虚拟机')).toBeVisible();
  await page.getByLabel('任务名称 *').fill('vm-direct-migration');
  await page.getByLabel('目标资源空间 *').selectOption('vm-workloads');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByLabel('erp-app-01')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('vm-direct-migration.png'), fullPage: true });
});

test('resource sizes, completed copy progress, dashboard links, and confirmations are normalized', async ({ page }, testInfo) => {
  await page.goto('/vms/source?provider=production-vcenter');
  await expect(page.locator('tr', { hasText: 'erp-app-01' }).getByText('520 GiB')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'erp-db-01' }).getByText('2.1 TiB')).toBeVisible();
  const selectAppearance = await page.getByLabel('电源状态').evaluate((element) => getComputedStyle(element).appearance);
  expect(selectAppearance).toBe('none');
  await expect(page.locator('.select-control', { has: page.getByLabel('电源状态') }).locator('.select-chevron')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('designed-selects.png'), fullPage: true });

  await page.goto('/plans/archive-wave-2026q2');
  await page.locator('.vm-detail', { hasText: 'archive-app-01' }).locator('summary').click();
  const diskStep = page.locator('.pipeline-step', { hasText: '复制虚拟机磁盘' });
  await expect(diskStep.locator('.step-icon.success')).toBeVisible();
  await expect(diskStep.locator('.spin')).toHaveCount(0);
  await expect(diskStep.getByText('100%')).toHaveCount(0);
  await expect(page.getByText('全部迁移步骤已完成')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('completed-migration-detail.png'), fullPage: true });

  await page.goto('/');
  await page.getByRole('link', { name: '查看失败虚拟机' }).click();
  await expect(page).toHaveURL(/\/plans\?status=vm-failed$/);
  await page.locator('tr', { hasText: 'erp-wave-01' }).getByRole('link', { name: '查看详情' }).click();
  await expect(page).toHaveURL(/\/plans\/erp-wave-01$/);
  await expect(page.getByText('1 台虚拟机迁移失败')).toBeVisible();

  await page.goto('/providers/sources');
  await page.getByRole('button', { name: '删除 legacy-openstack' }).click();
  const confirmDialog = page.getByRole('dialog', { name: '删除源集群连接' });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText('该操作无法自动撤销')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('confirmation-dialog.png'), fullPage: true });
  await confirmDialog.getByRole('button', { name: '取消' }).click();
  await expect(confirmDialog).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('designed-controls.png'), fullPage: true });
});

test('compatible sources, guided workflow, and inventory-backed mappings are discoverable', async ({ page }, testInfo) => {
  await page.goto('/');
  const guide = page.getByRole('region', { name: '迁移准备流程' });
  await expect(guide.locator('.guide-stage-title h3').getByText('连接迁移环境', { exact: true })).toBeVisible();
  await expect(guide.getByText('选择源端虚拟机', { exact: true })).toBeVisible();
  await expect(guide.getByText('确认网络与存储', { exact: true })).toBeVisible();
  await expect(guide.getByText('创建并执行任务', { exact: true })).toBeVisible();
  await expect(guide.getByText('可在任务向导内配置，也可提前创建并重复使用')).toBeVisible();
  await expect(guide.getByRole('link', { name: '提前创建配置' })).toBeVisible();
  await expect(guide.locator('.guide-node')).toHaveCount(4);
  await expect(guide.locator('.guide-stage.is-primary')).toHaveCount(0);
  await expect(guide.getByText(/Provider|NetworkMap|StorageMap/)).toHaveCount(0);
  await expect(guide.locator('.guide-track')).toHaveCount(1);
  await guide.getByRole('button', { name: '隐藏引导' }).click();
  await expect(guide.locator('.guide-stage')).toHaveCount(0);
  await guide.getByRole('button', { name: '显示引导' }).click();
  await expect(guide.locator('.guide-stage')).toHaveCount(4);
  const guideBox = await guide.boundingBox();
  expect(guideBox?.height).toBeGreaterThan(160);

  await page.goto('/providers/sources');
  await expect(page.getByRole('heading', { level: 2, name: '源端平台', exact: true })).toBeVisible();
  await expect(page.locator('main .eyebrow')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '源端平台连接' })).toBeVisible();
  await expect(page.getByText('虚拟机从这里迁出', { exact: true })).toHaveCount(0);
  await expect(page.getByText('host', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '连接源集群' }).click();
  const sourceDialog = page.getByRole('dialog', { name: '连接源集群' });
  await expect(sourceDialog.getByLabel('源平台类型 *').locator('option', { hasText: 'EIS 兼容虚拟化平台' })).toHaveCount(1);
  await sourceDialog.getByRole('button', { name: '关闭' }).click();

  await page.goto('/providers/targets');
  await expect(page.getByRole('heading', { level: 2, name: '目标集群', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '可用的目标集群' })).toBeVisible();
  await expect(page.getByText('本机自动连接，其他目标端按需添加')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'host' }).getByText('部署时自动连接，无需重复添加')).toBeVisible();
  await expect(page.getByText('production-vcenter', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑 host' })).toBeVisible();

  const targetName = `eis-target-${testInfo.project.name}`;
  await page.getByRole('button', { name: '添加其他目标集群' }).click();
  let targetDialog = page.getByRole('dialog', { name: '添加其他目标集群' });
  await expect(targetDialog.getByLabel('目标平台类型 *')).toBeDisabled();
  await targetDialog.getByLabel('名称 *').fill(targetName);
  await targetDialog.getByLabel('API 地址 *').fill('https://api.target.example:6443');
  await targetDialog.getByLabel('访问令牌 *').fill('target-token');
  await targetDialog.getByRole('button', { name: '创建并连接' }).click();
  const targetRow = page.locator('tr', { hasText: targetName });
  await expect(targetRow).toBeVisible();
  await targetRow.getByRole('button', { name: `编辑 ${targetName}` }).click();
  targetDialog = page.getByRole('dialog', { name: '编辑目标集群连接' });
  await targetDialog.getByLabel('API 地址 *').fill('https://api.target-new.example:6443');
  await targetDialog.getByRole('button', { name: '保存修改' }).click();
  await targetRow.getByRole('button', { name: `编辑 ${targetName}` }).click();
  targetDialog = page.getByRole('dialog', { name: '编辑目标集群连接' });
  await expect(targetDialog.getByLabel('API 地址 *')).toHaveValue('https://api.target-new.example:6443');
  await targetDialog.getByRole('button', { name: '关闭', exact: true }).click();

  await page.goto('/mappings');
  await expect(page.getByRole('heading', { level: 2, name: '网络与存储映射', exact: true })).toBeVisible();
  await expect(page.getByText('迁移前为什么要配置网络和存储？')).toBeVisible();
  await expect(page.getByText('源集群资源', { exact: true })).toBeVisible();
  await expect(page.getByText('EIS 目标资源', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('network-storage-overview.png'), fullPage: true });
  await page.getByRole('button', { name: '创建网络映射' }).click();
  const networkDialog = page.getByRole('dialog', { name: '创建网络配置' });
  await networkDialog.getByLabel('源网络').selectOption('network-21');
  await expect(networkDialog.getByText('3 台虚拟机正在使用：')).toBeVisible();
  await expect(networkDialog.getByText(/erp-app-01、erp-db-01、billing-win-01/)).toBeVisible();
  await expect(networkDialog.getByLabel('目标网络').locator('option', { hasText: '默认集群网络' })).toHaveCount(1);
  await expect(networkDialog.getByLabel('目标网络').locator('option', { hasText: 'vm-workloads / prod-vlan-120' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('inventory-backed-mapping.png'), fullPage: true });
});

test('target virtual machines show origin and duplicate names block plan creation', async ({ page }, testInfo) => {
  await page.goto('/vms/target?target=host');
  await expect(page.getByRole('heading', { level: 2, name: '目标端虚拟机', exact: true })).toBeVisible();
  await expect(page.getByLabel('虚拟机来源')).toHaveValue('migrated');
  const startingTargetRow = page.locator('tr', { hasText: 'erp-app-01' });
  await expect(startingTargetRow.getByRole('button', { name: '启动中' })).toBeDisabled();
  if (testInfo.project.name === 'desktop') {
    await expect(startingTargetRow.getByText('启动中', { exact: true }).first()).toBeVisible();
    await expect(startingTargetRow.getByText('系统盘 120 GiB')).toBeVisible();
    await expect(startingTargetRow.getByText('数据盘 400 GiB（1 块）')).toBeVisible();
  }
  await startingTargetRow.getByRole('button', { name: '详情' }).click();
  const startingDetail = page.getByRole('dialog', { name: 'erp-app-01' });
  await expect(startingDetail.getByText('启动中', { exact: true }).first()).toBeVisible();
  await expect(startingDetail.locator('.target-vm-disk-list').getByText('系统盘')).toBeVisible();
  await expect(startingDetail.locator('.target-vm-disk-list').getByText('数据盘')).toBeVisible();
  await expect(startingDetail.getByText('erp-app-01-rootdisk')).toBeVisible();
  await startingDetail.locator('.modal-footer').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('tr', { hasText: 'archive-app-01' }).getByText('由迁移创建')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'archive-app-01' }).getByRole('link', { name: 'archive-wave-2026q2' })).toBeVisible();
  const migratedTargetRow = page.locator('tr', { hasText: 'archive-app-01' });
  await expect(migratedTargetRow.getByRole('button', { name: '开机' })).toBeVisible();
  await expect(migratedTargetRow.getByRole('button', { name: '删除' })).toBeVisible();
  await migratedTargetRow.getByRole('button', { name: '开机' }).click();
  await page.getByRole('dialog', { name: '启动目标虚拟机' }).getByRole('button', { name: '确认开机' }).click();
  await expect(migratedTargetRow.getByRole('button', { name: '开机中' })).toBeDisabled();
  await expect(migratedTargetRow.getByRole('button', { name: '关机' })).toBeVisible({ timeout: 8_000 });
  await migratedTargetRow.getByRole('button', { name: '删除' }).click();
  const deleteTargetDialog = page.getByRole('dialog', { name: '删除目标虚拟机' });
  await expect(deleteTargetDialog.getByText('控制台不会额外发起磁盘清理')).toBeVisible();
  await deleteTargetDialog.getByRole('button', { name: '取消' }).click();
  await migratedTargetRow.getByRole('button', { name: '关机' }).click();
  await page.getByRole('dialog', { name: '关闭目标虚拟机' }).getByRole('button', { name: '确认关机' }).click();
  await expect(migratedTargetRow.getByRole('button', { name: '关机中' })).toBeDisabled();
  await expect(migratedTargetRow.getByRole('button', { name: '开机' })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('finance-core-01')).toHaveCount(0);
  await page.getByLabel('虚拟机来源').selectOption('original');
  await expect(page.locator('tr', { hasText: 'finance-core-01' }).getByText('目标集群原有')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('target-vms.png'), fullPage: true });

  await page.goto('/plans/new?provider=production-vcenter&vm=vm-101');
  await page.getByLabel('任务名称 *').fill('duplicate-check');
  await page.getByLabel('目标资源空间 *').selectOption('vm-workloads');
  await expect(page.getByText('目标资源空间已有 2 台虚拟机')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('发现 1 台同名虚拟机')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('duplicate-target-warning.png'), fullPage: true });

  await page.goto('/vms/target?target=host');
  const removableTargetRow = page.locator('tr', { hasText: 'archive-app-01' });
  await removableTargetRow.getByRole('button', { name: '删除' }).click();
  await page.getByRole('dialog', { name: '删除目标虚拟机' }).getByRole('button', { name: '确认删除' }).click();
  await expect(removableTargetRow.getByRole('button', { name: '删除中' })).toBeDisabled();
  await expect(removableTargetRow).toHaveCount(0, { timeout: 8_000 });
});
