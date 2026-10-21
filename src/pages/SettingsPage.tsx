import { useState } from 'react';
import { CheckCircle2, HardDrive, MonitorCog, ShieldAlert } from 'lucide-react';
import { useControllers, usePatchResource } from '../api/hooks';
import { buildValidationPatch } from '../domain/builders';
import type { ForkliftController } from '../domain/types';
import { Alert, Button, Field, Modal, PageState, StatusBadge, Toggle } from '../components/ui';

export function SettingsPage() {
  const query = useControllers();
  const patch = usePatchResource<ForkliftController>('forkliftcontrollers');
  const controller = query.data?.items.find((item) => item.metadata.name === 'forklift-controller') || query.data?.items[0];
  const validationEnabled = controller?.spec.feature_validation !== 'false';
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const updateValidation = (enabled: boolean) => {
    if (!controller) return;
    patch.mutate(
      { name: controller.metadata.name, patch: buildValidationPatch(enabled) },
      { onSuccess: () => { setConfirmOpen(false); setConfirmText(''); } },
    );
  };

  return <>
    <div className="page-heading"><div><h2>系统设置</h2><p>管理所有迁移计划共用的检查策略。</p></div></div>
    <PageState loading={query.isLoading} error={query.error}>
      <div className="settings-grid">
        <section className="panel settings-section">
          <h2>迁移兼容性检查</h2><p>在迁移开始前检查源虚拟机，尽早发现可能导致迁移或启动失败的问题。</p>
          {patch.error && <Alert tone="danger" title="更新失败">{patch.error.message}</Alert>}
          <Toggle checked={validationEnabled} onChange={(enabled) => enabled ? updateValidation(true) : setConfirmOpen(true)} label="启用迁移兼容性检查" description="建议保持启用。关闭后，部分存在磁盘空间、文件系统或驱动问题的虚拟机也可以创建迁移计划，但失败风险会增加。" />
          <div style={{ marginTop: 14 }}><Alert tone={validationEnabled ? 'success' : 'warning'} title={validationEnabled ? '迁移检查已启用' : '迁移检查已关闭'}>{validationEnabled ? '新同步的虚拟机会自动接受兼容性检查。每个迁移计划仍可根据实际情况调整迁移前检查。' : '存在风险的虚拟机可能不再被提前阻止，请在迁移窗口前完成人工核查。'}</Alert></div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="panel settings-section"><h2>检查范围</h2><p>关闭迁移检查后，以下问题不会再阻止计划创建。</p>
            <div className="health-list" style={{ margin: '0 -18px -18px' }}>
              <div className="health-item"><div className="health-icon"><HardDrive size={17} /></div><div><strong>磁盘可用空间</strong><small>识别分区已满等问题</small></div><StatusBadge tone={validationEnabled ? 'success' : 'warning'}>{validationEnabled ? '检查中' : '已跳过'}</StatusBadge></div>
              <div className="health-item"><div className="health-icon"><CheckCircle2 size={17} /></div><div><strong>文件系统状态</strong><small>识别损坏或不可访问的文件系统</small></div><StatusBadge tone={validationEnabled ? 'success' : 'warning'}>{validationEnabled ? '检查中' : '已跳过'}</StatusBadge></div>
              <div className="health-item"><div className="health-icon"><MonitorCog size={17} /></div><div><strong>系统与驱动兼容性</strong><small>识别启动和联网风险</small></div><StatusBadge tone={validationEnabled ? 'success' : 'warning'}>{validationEnabled ? '检查中' : '已跳过'}</StatusBadge></div>
            </div>
          </section>
        </div>
      </div>
    </PageState>

    <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="关闭全局迁移校验" description="这是集群级高风险操作，不只影响当前计划。"
      footer={<><Button variant="secondary" onClick={() => setConfirmOpen(false)}>取消</Button><Button variant="danger" disabled={confirmText !== '关闭校验' || patch.isPending} onClick={() => updateValidation(false)}>{patch.isPending ? '正在更新...' : '确认关闭'}</Button></>}>
      <Alert tone="danger" title="关闭后的影响">磁盘分区已满、文件系统异常、系统或驱动不兼容等问题可能不会在迁移前被拦截，故障会推迟到复制、系统适配或首次启动阶段。</Alert>
      <div style={{ marginTop: 16 }}><Field label="输入“关闭校验”以确认"><input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="关闭校验" /></Field></div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', color: '#687383', fontSize: 12 }}><ShieldAlert size={16} />完成特殊镜像迁移后应立即重新启用。</div>
    </Modal>
  </>;
}
