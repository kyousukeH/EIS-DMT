import { useState, type CSSProperties } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, ArrowUpRight, ChevronDown, ChevronUp, CircleCheckBig, GitBranch, HardDriveDownload, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNetworkMaps, usePlans, useProviders, useStorageMaps } from '../api/hooks';
import { diskTransferProgressPercent, getCurrentDiskTransferStep, getPlanMigrationType, getPlanStatus, getStepFailure, getVmFailure, isDiskTransferComplete } from '../domain/status';
import { isEISTargetProvider, isSourceProvider, providerDisplayType } from '../domain/providers';
import { PageState, ProgressBar, StatusBadge, formatDate } from '../components/ui';

export function DashboardPage() {
  const [guideCollapsed, setGuideCollapsed] = useState(false);
  const providers = useProviders();
  const plans = usePlans();
  const networkMaps = useNetworkMaps();
  const storageMaps = useStorageMaps();
  const providerItems = providers.data?.items || [];
  const planItems = plans.data?.items || [];
  const running = planItems.filter((plan) => getPlanStatus(plan).tone === 'running');
  const failedVMs = planItems.flatMap((plan) => plan.status?.migration?.vms || []).filter(getVmFailure);
  const failedPlans = planItems.filter((plan) => (plan.status?.migration?.vms || []).some(getVmFailure));
  const successful = planItems.filter((plan) => getPlanStatus(plan).tone === 'success').length;
  const readyProviders = providerItems.filter((provider) => provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True')).length;
  const readySources = providerItems.filter((provider) => isSourceProvider(provider)
    && provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
  const readyTargets = providerItems.filter((provider) => isEISTargetProvider(provider)
    && provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
  const readyNetworkMaps = (networkMaps.data?.items || []).filter((mapping) => mapping.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
  const readyStorageMaps = (storageMaps.data?.items || []).filter((mapping) => mapping.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
  const networkReady = readyNetworkMaps.length > 0;
  const storageReady = readyStorageMaps.length > 0;
  const targetReady = readyTargets.length > 0;
  const planReady = planItems.length > 0;
  const guideStates = [readySources.length > 0, targetReady, networkReady, storageReady, planReady];
  const guideCompleted = guideStates.filter(Boolean).length;
  const guidePercent = guideCompleted * 20;
  const failedTarget = failedPlans.length === 1 ? `/plans/${failedPlans[0].metadata.name}#failed-vms` : '/plans?status=vm-failed';

  return <>
    <div className="page-heading dashboard-heading">
      <div><p>查看迁移准备情况、执行进度和需要处理的异常。</p></div>
      <div className="page-actions"><Link className="button button-primary" to="/plans/new"><GitBranch size={16} />创建迁移计划</Link></div>
    </div>

    <section className={`migration-guide ${guideCollapsed ? 'is-collapsed' : ''}`} aria-label="迁移准备流程">
      <div className="migration-guide-heading">
        <div className="migration-guide-title"><ArrowLeftRight size={21} /><h2>迁移准备引导</h2></div>
        <div className="migration-guide-tools"><div className="migration-guide-readiness"><span>就绪度</span><strong>{guideCompleted}/5</strong><span className={`guide-overall-status ${guideCompleted === 5 ? 'is-ready' : ''}`}><i />{guideCompleted === 5 ? '环境已就绪' : `还差 ${5 - guideCompleted} 步`}</span></div><button type="button" className="guide-toggle" aria-expanded={!guideCollapsed} onClick={() => setGuideCollapsed((value) => !value)}>{guideCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}{guideCollapsed ? '显示引导' : '隐藏引导'}</button></div>
      </div>
      {!guideCollapsed && <div className="migration-guide-flow" style={{ '--guide-progress': `${guidePercent}%` } as CSSProperties}>
        <div className="guide-track" role="progressbar" aria-label="迁移准备完成度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={guidePercent}><span /></div>
        <div className={`guide-stage ${readySources.length ? 'is-complete' : 'is-current'}`}>
          <div className="guide-node">1</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>连接源集群</h3><span>{readySources.length ? '已完成' : '待完成'}</span></div><p>连接虚机所在环境，读取虚拟机、磁盘和网络。</p><div className="guide-stage-meta"><span>{readySources.length ? `已连接 ${readySources.length} 个源集群` : '尚未连接源集群'}</span></div><Link className="guide-stage-link" to="/providers/sources">{readySources.length ? '查看源集群' : '立即连接'}<ArrowRight size={13} /></Link></div>
        </div>
        <div className={`guide-stage ${targetReady ? 'is-complete' : readySources.length ? 'is-current' : ''}`}>
          <div className="guide-node">2</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>添加目标集群</h3><span>{targetReady ? '已完成' : '待完成'}</span></div><p>指定接收迁移后虚拟机的 EIS 目标集群。</p><div className="guide-stage-meta"><span>{targetReady ? `已添加 ${readyTargets.length} 个目标集群` : '尚未添加目标集群'}</span></div><Link className="guide-stage-link" to="/providers/targets">{targetReady ? '查看目标集群' : '立即添加'}<ArrowRight size={13} /></Link></div>
        </div>
        <div className={`guide-stage ${networkReady ? 'is-complete' : targetReady ? 'is-current' : ''}`}>
          <div className="guide-node">3</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>配置虚拟机网络</h3><span>{networkReady ? '已完成' : '待完成'}</span></div><p>选择虚拟机迁移后需要接入的目标网络。</p><div className="guide-stage-meta"><span>{networkReady ? `${readyNetworkMaps.length} 项网络配置已保存` : '尚未配置网络'}</span></div><Link className="guide-stage-link" to="/mappings?tab=network">{networkReady ? '查看网络配置' : '开始配置'}<ArrowRight size={13} /></Link></div>
        </div>
        <div className={`guide-stage ${storageReady ? 'is-complete' : networkReady ? 'is-current' : ''}`}>
          <div className="guide-node">4</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>配置磁盘存储</h3><span>{storageReady ? '已完成' : '待完成'}</span></div><p>选择虚拟机磁盘迁移后的存储位置和方式。</p><div className="guide-stage-meta"><span>{storageReady ? `${readyStorageMaps.length} 项存储配置已保存` : '尚未配置存储'}</span></div><Link className="guide-stage-link" to="/mappings?tab=storage">{storageReady ? '查看存储配置' : '开始配置'}<ArrowRight size={13} /></Link></div>
        </div>
        <div className={`guide-stage ${planReady ? 'is-complete' : networkReady && storageReady ? 'is-current' : ''}`}>
          <div className="guide-node">5</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>选择虚拟机并迁移</h3><span>{planReady ? '已完成' : '待完成'}</span></div><p>选择虚拟机，确认目标位置和方式后启动迁移。</p><div className="guide-stage-meta"><span>{planReady ? `已创建 ${planItems.length} 个迁移计划` : '尚未创建迁移计划'}</span></div><Link className="guide-stage-link" to="/vms/source">{planReady ? '迁移更多虚拟机' : '选择虚拟机'}<ArrowRight size={13} /></Link></div>
        </div>
      </div>}
    </section>

    <div className="metric-grid">
      <Link className="metric metric-link" to="/providers/sources" aria-label="查看集群连接"><div className="metric-header"><span>集群连接</span><Server size={18} /></div><div className="metric-value"><strong>{readyProviders}/{providerItems.length}</strong><span>连接正常</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link" to="/plans?status=running" aria-label="查看执行中的计划"><div className="metric-header"><span>执行中的计划</span><HardDriveDownload size={18} /></div><div className="metric-value"><strong>{running.length}</strong><span>批迁移</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link" to="/plans?status=success" aria-label="查看已完成计划"><div className="metric-header"><span>已完成计划</span><CircleCheckBig size={18} /></div><div className="metric-value"><strong>{successful}</strong><span>当前命名空间</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link metric-danger" to={failedTarget} aria-label="查看失败虚拟机"><div className="metric-header"><span>失败虚拟机</span><AlertTriangle size={18} /></div><div className="metric-value"><strong>{failedVMs.length}</strong><span>需要处理</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
    </div>

    <PageState loading={providers.isLoading || plans.isLoading || networkMaps.isLoading || storageMaps.isLoading} error={providers.error || plans.error || networkMaps.error || storageMaps.error}>
      <div className="content-grid">
        <section className="panel table-panel">
          <div className="panel-header"><h2>近期迁移计划</h2><Link to="/plans">查看全部</Link></div>
          <table className="data-table">
            <thead><tr><th>计划</th><th>类型</th><th>状态</th><th>VM</th><th>开始时间</th></tr></thead>
            <tbody>{planItems.slice(0, 6).map((plan) => {
              const status = getPlanStatus(plan);
              return <tr key={plan.metadata.name}>
                <td><Link to={`/plans/${plan.metadata.name}`}>{plan.metadata.name}</Link><span className="cell-subtitle">{plan.spec.description}</span></td>
                <td><span className="type-badge">{getPlanMigrationType(plan)}</span></td>
                <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
                <td>{plan.spec.vms.length}</td>
                <td>{formatDate(plan.status?.migration?.started)}</td>
              </tr>;
            })}</tbody>
          </table>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="panel">
            <div className="panel-header"><h3>集群连接状态</h3><Link to="/providers/sources">管理</Link></div>
            <div className="health-list">{providerItems.map((provider) => {
              const ready = provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True');
              return <div className="health-item" key={provider.metadata.name}>
                <div className="health-icon"><Server size={17} /></div>
                <div><strong>{provider.metadata.name}</strong><small>{providerDisplayType(provider)}</small></div>
                <StatusBadge tone={ready ? 'success' : 'danger'}>{ready ? '正常' : '异常'}</StatusBadge>
              </div>;
            })}</div>
          </section>
          {running[0] && <section className="panel">
            <div className="panel-header"><h3>当前磁盘复制</h3><Link to={`/plans/${running[0].metadata.name}`}>详情</Link></div>
            <div className="panel-body">
              {(running[0].status?.migration?.vms || []).map((vm) => {
                const copy = getCurrentDiskTransferStep(vm);
                if (!copy) return null;
                const copyFailed = getStepFailure(copy).length > 0;
                const copyComplete = isDiskTransferComplete(vm, copy);
                return <div key={vm.id} style={{ marginBottom: 14 }}><ProgressBar label={vm.name || vm.id} value={diskTransferProgressPercent(vm, copy)} tone={copyFailed ? 'danger' : copyComplete ? 'success' : 'normal'} /></div>;
              })}
            </div>
          </section>}
        </div>
      </div>
    </PageState>
  </>;
}
