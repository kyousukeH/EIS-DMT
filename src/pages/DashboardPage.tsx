import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, ArrowUpRight, ChevronDown, ChevronUp, CircleCheckBig, GitBranch, HardDriveDownload, Monitor, Server, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePlans, useProviders } from '../api/hooks';
import { diskTransferProgressPercent, getCurrentDiskTransferStep, getMigrationTypeLabel, getPlanActivityTime, getPlanMigrationType, getPlanStatus, getStepFailure, getVmFailure, isDiskTransferComplete } from '../domain/status';
import { isEISTargetProvider, isLocalEISTargetProvider, isSourceProvider, providerDisplayType } from '../domain/providers';
import { PageState, ProgressBar, StatusBadge, formatDate } from '../components/ui';

export function DashboardPage() {
  const [guideCollapsed, setGuideCollapsed] = useState(false);
  const providers = useProviders();
  const plans = usePlans();
  const providerItems = providers.data?.items || [];
  const planItems = plans.data?.items || [];
  const recentPlans = [...planItems].sort((left, right) => getPlanActivityTime(right) - getPlanActivityTime(left)).slice(0, 6);
  const running = planItems.filter((plan) => getPlanStatus(plan).tone === 'running');
  const failedVMs = planItems.flatMap((plan) => plan.status?.migration?.vms || []).filter(getVmFailure);
  const failedPlans = planItems.filter((plan) => (plan.status?.migration?.vms || []).some(getVmFailure));
  const successful = planItems.filter((plan) => getPlanStatus(plan).tone === 'success').length;
  const readySources = providerItems.filter((provider) => isSourceProvider(provider)
    && provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
  const readyTargets = providerItems.filter((provider) => isEISTargetProvider(provider)
    && provider.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'));
  const readyLocalTargets = readyTargets.filter(isLocalEISTargetProvider);
  const failedTarget = failedPlans.length === 1 ? `/plans/${failedPlans[0].metadata.name}#failed-vms` : '/plans?status=vm-failed';

  return <>
    <div className="page-heading dashboard-heading">
      <div><p>查看迁移准备情况、执行进度和需要处理的异常。</p></div>
      <div className="page-actions"><Link className="button button-primary" to="/plans/new"><GitBranch size={16} />创建迁移任务</Link></div>
    </div>

    <section className={`migration-guide ${guideCollapsed ? 'is-collapsed' : ''}`} aria-label="迁移准备流程">
      <div className="migration-guide-heading">
        <div className="migration-guide-title"><ArrowLeftRight size={21} /><h2>迁移准备引导</h2></div>
        <button type="button" className="guide-toggle" aria-expanded={!guideCollapsed} onClick={() => setGuideCollapsed((value) => !value)}>{guideCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}{guideCollapsed ? '显示引导' : '隐藏引导'}</button>
      </div>
      {!guideCollapsed && <div className="migration-guide-flow">
        <div className="guide-track" aria-hidden="true" />
        <div className="guide-stage">
          <div className="guide-node">1</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>连接迁移环境</h3></div><p>连接虚拟机所在的源端平台，并确认接收虚拟机的 EIS 目标集群。</p><div className="guide-stage-meta"><span>{readySources.length} 个源端、{readyTargets.length} 个目标端连接正常</span></div><div className="guide-stage-links"><Link className="guide-stage-link" to="/providers/sources">源端平台<ArrowRight size={13} /></Link><Link className="guide-stage-link secondary" to="/providers/targets">目标集群<ArrowRight size={13} /></Link></div></div>
        </div>
        <div className="guide-stage">
          <div className="guide-node">2</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>选择源端虚拟机</h3></div><p>查看资源配置和迁移评估，选择本批次需要迁移的虚拟机。</p><div className="guide-stage-meta"><span>{readyLocalTargets.length > 0 ? '本机目标端已自动连接' : '请先确认目标集群连接'}</span></div><Link className="guide-stage-link" to="/vms/source">查看源端虚拟机<ArrowRight size={13} /></Link></div>
        </div>
        <div className="guide-stage">
          <div className="guide-node">3</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>确认网络与存储</h3></div><p>为源虚拟机使用的网络和磁盘选择迁移后的目标位置。</p><div className="guide-stage-meta"><span>可在任务向导内配置，也可提前创建并重复使用</span></div><Link className="guide-stage-link" to="/mappings">提前创建配置<ArrowRight size={13} /></Link></div>
        </div>
        <div className="guide-stage">
          <div className="guide-node">4</div>
          <div className="guide-stage-main"><div className="guide-stage-title"><h3>创建并执行任务</h3></div><p>确认迁移方式、系统适配和启动策略，保存后开始迁移并跟踪进度。</p><div className="guide-stage-meta"><span>向导会在提交前汇总全部配置</span></div><Link className="guide-stage-link" to="/plans/new">创建迁移任务<ArrowRight size={13} /></Link></div>
        </div>
      </div>}
    </section>

    <div className="metric-grid">
      <Link className="metric metric-link" to="/providers/sources" aria-label="查看源端平台"><div className="metric-header"><span>源端平台</span><Server size={18} /></div><div className="metric-value"><strong>{readySources.length}</strong><span>连接正常</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link" to="/providers/targets" aria-label="查看目标集群"><div className="metric-header"><span>目标集群</span><ShieldCheck size={18} /></div><div className="metric-value"><strong>{readyTargets.length}</strong><span>连接正常</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link" to="/plans?status=running" aria-label="查看执行中的任务"><div className="metric-header"><span>执行中的任务</span><HardDriveDownload size={18} /></div><div className="metric-value"><strong>{running.length}</strong><span>批迁移</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link" to="/plans?status=success" aria-label="查看已完成任务"><div className="metric-header"><span>已完成任务</span><CircleCheckBig size={18} /></div><div className="metric-value"><strong>{successful}</strong><span>迁移批次</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
      <Link className="metric metric-link metric-danger" to={failedTarget} aria-label="查看失败虚拟机"><div className="metric-header"><span>失败虚拟机</span><AlertTriangle size={18} /></div><div className="metric-value"><strong>{failedVMs.length}</strong><span>需要处理</span><ArrowUpRight className="metric-link-icon" size={16} /></div></Link>
    </div>

    <PageState loading={providers.isLoading || plans.isLoading} error={providers.error || plans.error}>
      <div className="content-grid">
        <section className="panel table-panel">
          <div className="panel-header"><h2>最近 6 个迁移任务</h2><span className="panel-header-actions"><small>按最近活动时间排序</small><Link to="/plans">查看全部</Link></span></div>
          {recentPlans.length === 0 ? <div className="dashboard-empty"><Monitor size={24} /><strong>尚未创建迁移任务</strong><span>从选择源端虚拟机开始，向导会带你完成其余配置。</span><Link className="button button-primary" to="/vms/source">查看源端虚拟机</Link></div> : <table className="data-table">
            <thead><tr><th>任务</th><th>迁移类型</th><th>状态</th><th>虚拟机</th><th>最近活动</th></tr></thead>
            <tbody>{recentPlans.map((plan) => {
              const status = getPlanStatus(plan);
              return <tr key={plan.metadata.name}>
                <td><Link to={`/plans/${plan.metadata.name}`}>{plan.metadata.name}</Link><span className="cell-subtitle">{plan.spec.description}</span></td>
                <td><span className="type-badge">{getMigrationTypeLabel(getPlanMigrationType(plan))}</span></td>
                <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
                <td>{plan.spec.vms.length}</td>
                <td>{formatDate(new Date(getPlanActivityTime(plan)).toISOString())}</td>
              </tr>;
            })}</tbody>
          </table>}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="panel">
            <div className="panel-header"><h3>集群连接状态</h3><span className="panel-header-actions"><Link to="/providers/sources">源端</Link><Link to="/providers/targets">目标端</Link></span></div>
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
