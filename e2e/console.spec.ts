import { expect, test } from '@playwright/test';

test('dashboard renders operational status without overflow', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '迁移总览', exact: true })).toBeVisible();
  await expect(page.getByText('从这里开始迁移')).toHaveCount(0);
  await expect(page.getByText('当前磁盘复制')).toBeVisible();
  await expect(page.getByText('erp-wave-01').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
});

test('migration detail exposes disk progress and failure reasons', async ({ page }, testInfo) => {
  await page.goto('/plans/erp-wave-01');
  await expect(page.getByText('总体磁盘复制')).toBeVisible();
  await expect(page.getByText('失败阶段：系统适配')).toBeVisible();
  await expect(page.getByText('目标磁盘空间不足，virt-v2v 无法写入临时文件。')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('migration-detail.png'), fullPage: true });
});

test('plan wizard validates names and presents resource-aware settings', async ({ page }, testInfo) => {
  await page.goto('/plans/new');
  const nameInput = page.getByLabel('计划名称 *');
  await nameInput.fill('Invalid Plan_');
  await expect(nameInput).toHaveValue('invalidplan_');
  await expect(page.getByText('名称必须以字母或数字开头和结尾')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await nameInput.fill('erp-wave-01');
  await expect(page.getByText('已经存在同名迁移计划')).toBeVisible();
  await nameInput.fill('test-wave');
  await page.getByLabel('目标命名空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByText('erp-app-01').click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '迁移评估', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '网络配置', exact: true })).toBeVisible();
  await expect(page.getByLabel('搜索网络配置')).toBeVisible();
  await expect(page.locator('.wizard-selected-config').first().getByText('已选择')).toBeVisible();
  await expect(page.getByText('源网络标识：network-21')).toHaveCount(0);
  await page.getByRole('button', { name: '查看规则' }).first().click();
  await expect(page.getByText('源网络标识：network-21')).toBeVisible();
  await expect(page.getByText('关联虚拟机：erp-app-01').first()).toBeVisible();
  await expect(page.getByText('Multus 网络').first()).toBeVisible();
  await page.getByRole('button', { name: '查看规则' }).last().click();
  await expect(page.getByText('目标存储名称').first()).toBeVisible();
  await expect(page.getByText(/卷模式\s+Block/).first()).toBeVisible();
  await expect(page.getByText(/访问模式\s+ReadWriteOnce/).first()).toBeVisible();
  await expect(page.getByText(/网络去向|存储去向/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('plan-mappings.png'), fullPage: true });
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '迁移设置', exact: true })).toBeVisible();
  await expect(page.getByText('执行系统适配')).toBeVisible();
  await expect(page.getByText('执行迁移前检查')).toBeVisible();
  await expect(page.getByText('conversion', { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toContainText('迁移设置');
  await expect(page.locator('[aria-current="step"]')).toBeInViewport();
  await page.getByText('执行迁移前检查').click();
  await expect(page.getByText('迁移前检查已关闭')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plan-options.png'), fullPage: true });
});

test('critical virtual machines explain blockers and prevent continuing', async ({ page }, testInfo) => {
  await page.goto('/plans/new');
  await page.getByLabel('计划名称 *').fill('blocked-vm-check');
  await page.getByLabel('目标命名空间 *').selectOption('billing');
  await page.getByRole('button', { name: '下一步' }).click();
  const vmRow = page.locator('.vm-row', { hasText: 'legacy-router' });
  await vmRow.locator('input[type="checkbox"]').check();
  await expect(page.getByText('所选虚拟机包含迁移阻塞项')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await vmRow.locator('.risk-tooltip').focus();
  await expect(vmRow.getByRole('tooltip')).toBeVisible();
  await expect(vmRow.getByText('检测到不支持的磁盘控制器')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('blocked-vm-tooltip.png'), fullPage: true });
});

test('legacy plans have a stable type and wait for the current Ready condition', async ({ page }) => {
  await page.goto('/plans');
  const row = page.locator('tr', { hasText: 'validation-pending' });
  await expect(row.getByRole('link', { name: '查看详情' })).toBeVisible();
  await expect(row.locator('.type-badge')).toHaveText('cold');
  await expect(row.getByRole('button', { name: '开始迁移' })).toHaveCount(0);

  await page.goto('/plans/validation-pending');
  await expect(page.getByText('COLD', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始迁移' })).toHaveCount(0);
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
  await expect(page.getByRole('heading', { level: 2, name: '编辑迁移计划', exact: true })).toBeVisible();
  await expect(page.getByLabel('计划名称 *')).toBeDisabled();
  await page.getByLabel('描述').fill('账务 Windows 工作负载（已调整）');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '保存修改' }).click();
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
  await page.getByRole('button', { name: '编辑 ceph-block-default' }).click();
  const mappingDialog = page.getByRole('dialog', { name: '编辑存储配置' });
  await expect(mappingDialog.getByText('共 2 条')).toBeVisible();
  await mappingDialog.getByLabel('访问模式 *').first().selectOption('ReadWriteMany');
  await mappingDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('卷模式：Block / 访问模式：ReadWriteMany')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editable-resources.png'), fullPage: true });
});

test('warm migration supports immediate and scheduled Cutover with final transfer progress', async ({ page }, testInfo) => {
  await page.goto('/plans/warm-sync-01');
  await expect(page.getByText('WARM', { exact: true })).toBeVisible();
  await expect(page.getByText('完成磁盘传输总进度')).toBeVisible();
  await expect(page.getByText('最终同步')).toBeVisible();

  await page.getByRole('button', { name: '设置 Cutover' }).click();
  let dialog = page.getByRole('dialog', { name: '设置 Cutover' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '立即执行', exact: true }).last().click();
  await expect(page.getByText('Cutover 已安排')).toBeVisible();

  await page.getByRole('button', { name: '修改 Cutover' }).click();
  dialog = page.getByRole('dialog', { name: '修改 Cutover' });
  await dialog.getByRole('button', { name: '计划时间' }).click();
  await dialog.getByLabel('计划执行时间 *').fill('2099-12-31T23:30');
  await dialog.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByText('Cutover 已安排')).toBeVisible();

  await page.getByRole('button', { name: '修改 Cutover' }).click();
  await page.getByRole('dialog', { name: '修改 Cutover' }).getByRole('button', { name: '取消计划' }).click();
  await expect(page.getByText('Cutover 已安排')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '设置 Cutover' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('warm-cutover-progress.png'), fullPage: true });
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
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
});

test('virtual machines can start a migration with provider and workload preselected', async ({ page }, testInfo) => {
  await page.goto('/vms/source?provider=production-vcenter');
  await expect(page.getByRole('heading', { level: 2, name: '源集群虚拟机', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText('production-vcenter', { exact: true }).first()).toBeVisible();
  const vmRow = page.locator('tr', { hasText: 'erp-app-01' });
  await expect(vmRow.getByText('运行中')).toBeVisible();
  await vmRow.getByRole('link', { name: '迁移', exact: true }).click();

  await expect(page).toHaveURL(/\/plans\/new\?provider=production-vcenter&vm=vm-101/);
  await expect(page.getByLabel('源集群 *')).toHaveValue('production-vcenter');
  await expect(page.getByText('已从资源列表选择 1 台虚拟机')).toBeVisible();
  await page.getByLabel('计划名称 *').fill('vm-direct-migration');
  await page.getByLabel('目标命名空间 *').selectOption('vm-workloads');
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
  const diskStep = page.locator('.pipeline-step', { hasText: '复制磁盘' });
  await expect(diskStep.getByText('100%').first()).toBeVisible();
  await expect(diskStep.locator('.step-icon.success')).toBeVisible();
  await expect(diskStep.locator('.spin')).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('link', { name: '查看失败虚拟机' }).click();
  await expect(page).toHaveURL(/\/plans\/erp-wave-01#failed-vms$/);
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

test('KubeVirt sources, guided workflow, and inventory-backed mappings are discoverable', async ({ page }, testInfo) => {
  await page.goto('/');
  const guide = page.getByRole('region', { name: '迁移准备流程' });
  await expect(guide.locator('.guide-stage-title h3').getByText('连接源集群', { exact: true })).toBeVisible();
  await expect(guide.getByText('添加目标集群', { exact: true })).toBeVisible();
  await expect(guide.getByText('配置虚拟机网络', { exact: true })).toBeVisible();
  await expect(guide.getByText('配置磁盘存储', { exact: true })).toBeVisible();
  await expect(guide.getByText('选择虚拟机并迁移')).toBeVisible();
  await expect(guide.getByText(/Provider|NetworkMap|StorageMap/)).toHaveCount(0);
  await expect(guide.locator('.guide-track')).toHaveCount(1);
  await guide.getByRole('button', { name: '隐藏引导' }).click();
  await expect(guide.locator('.guide-stage')).toHaveCount(0);
  await guide.getByRole('button', { name: '显示引导' }).click();
  await expect(guide.locator('.guide-stage')).toHaveCount(5);
  const guideBox = await guide.boundingBox();
  expect(guideBox?.height).toBeGreaterThan(240);

  await page.goto('/providers/sources');
  await expect(page.getByRole('heading', { level: 2, name: '源集群', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已连接的源集群' })).toBeVisible();
  await expect(page.getByText('host', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '连接源集群' }).click();
  const sourceDialog = page.getByRole('dialog', { name: '连接源集群' });
  await expect(sourceDialog.getByLabel('源平台类型 *').locator('option', { hasText: 'KubeVirt 集群' })).toHaveCount(1);
  await sourceDialog.getByRole('button', { name: '关闭' }).click();

  await page.goto('/providers/targets');
  await expect(page.getByRole('heading', { level: 2, name: '目标集群', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '可用的目标集群' })).toBeVisible();
  await expect(page.getByText('production-vcenter', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑 host' })).toBeVisible();

  const targetName = `eis-target-${testInfo.project.name}`;
  await page.getByRole('button', { name: '添加目标集群' }).click();
  let targetDialog = page.getByRole('dialog', { name: '添加目标集群' });
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
  await expect(page.getByRole('heading', { level: 2, name: '网络与存储配置', exact: true })).toBeVisible();
  await expect(page.getByText('迁移前为什么要配置网络和存储？')).toBeVisible();
  await expect(page.getByText('源集群资源', { exact: true })).toBeVisible();
  await expect(page.getByText('EIS 目标资源', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('network-storage-overview.png'), fullPage: true });
  await page.getByRole('button', { name: '创建网络配置' }).click();
  const networkDialog = page.getByRole('dialog', { name: '创建网络配置' });
  await networkDialog.getByLabel('源网络').selectOption('network-21');
  await expect(networkDialog.getByText('3 台虚拟机正在使用：')).toBeVisible();
  await expect(networkDialog.getByText(/erp-app-01、erp-db-01、billing-win-01/)).toBeVisible();
  await expect(networkDialog.getByLabel('目标网络').locator('option', { hasText: 'Pod 网络（集群默认）' })).toHaveCount(1);
  await expect(networkDialog.getByLabel('目标网络').locator('option', { hasText: 'vm-workloads / prod-vlan-120' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('inventory-backed-mapping.png'), fullPage: true });
});

test('target virtual machines show origin and duplicate names block plan creation', async ({ page }, testInfo) => {
  await page.goto('/vms/target?target=host');
  await expect(page.getByRole('heading', { level: 2, name: '目标集群虚拟机', exact: true })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'archive-app-01' }).getByText('由迁移创建')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'archive-app-01' }).getByRole('link', { name: 'archive-wave-2026q2' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'finance-core-01' }).getByText('目标集群原有')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('target-vms.png'), fullPage: true });

  await page.goto('/plans/new?provider=production-vcenter&vm=vm-101');
  await page.getByLabel('计划名称 *').fill('duplicate-check');
  await page.getByLabel('目标命名空间 *').selectOption('vm-workloads');
  await expect(page.getByText('目标命名空间已有 2 台虚拟机')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('发现 1 台同名虚拟机')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('duplicate-target-warning.png'), fullPage: true });
});
