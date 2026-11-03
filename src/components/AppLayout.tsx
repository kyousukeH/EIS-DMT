import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity, Boxes, ChevronLeft, ChevronRight, Gauge, GitBranch, ListChecks, Menu, Monitor,
  MonitorCheck, Network, Server, Settings, ShieldCheck, Waypoints, X,
} from 'lucide-react';
import type { RuntimeConfig } from '../domain/types';
import { IconButton } from './ui';

const workflowNav = [
  {
    label: '环境纳管', icon: Boxes,
    items: [
      { to: '/providers/sources', label: '源端平台', icon: Server, end: true },
      { to: '/providers/targets', label: '目标集群', icon: ShieldCheck, end: true },
    ],
  },
  {
    label: '资产与规则', icon: Network,
    items: [
      { to: '/vms/source', label: '源端虚拟机', icon: Monitor, end: true },
      { to: '/mappings', label: '网络与存储映射', icon: Waypoints, end: false },
    ],
  },
  {
    label: '迁移作业', icon: GitBranch,
    items: [
      { to: '/plans', label: '迁移任务', icon: ListChecks, end: false },
      { to: '/vms/target', label: '目标端虚拟机', icon: MonitorCheck, end: true },
    ],
  },
];

const titles: Record<string, string> = {
  '/': '迁移总览', '/vms': '源端虚拟机', '/vms/source': '源端虚拟机', '/vms/target': '目标端虚拟机',
  '/providers': '源端平台', '/providers/sources': '源端平台', '/providers/targets': '目标集群', '/mappings': '网络与存储映射',
  '/plans': '迁移任务', '/plans/new': '迁移任务', '/settings': '系统设置',
};

export function AppLayout({ config }: { config: RuntimeConfig }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = location.pathname.startsWith('/plans') ? '迁移任务' : titles[location.pathname] || 'EIS-DMT';

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    {mobileOpen && <button className="mobile-overlay" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand">
        <div className="brand-mark"><Activity size={21} /></div>
        {!collapsed && <div><strong>EIS-DMT</strong><span>迁移控制台</span></div>}
        <IconButton label="关闭导航" onClick={() => setMobileOpen(false)}><X size={18} /></IconButton>
      </div>
      <nav aria-label="主导航">
        <NavLink className="nav-home" to="/" end onClick={() => setMobileOpen(false)} title={collapsed ? '迁移总览' : undefined}>
          <Gauge size={18} /><span>迁移总览</span>
        </NavLink>
        <span className="nav-section-label">迁移流程</span>
        {workflowNav.map((section) => <div className="nav-flow-section" key={section.label}>
          <div className="nav-flow-heading"><section.icon size={18} /><span>{section.label}</span></div>
          <div className="nav-flow-items">{section.items.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined}>
            <span className="nav-flow-icon"><Icon size={16} /></span><span className="nav-flow-label">{label}</span>
          </NavLink>)}</div>
        </div>)}
        <div className="nav-system">
          <span className="nav-section-label">平台管理</span>
          <NavLink to="/settings" onClick={() => setMobileOpen(false)} title={collapsed ? '系统设置' : undefined}><Settings size={18} /><span>系统设置</span></NavLink>
        </div>
      </nav>
      <button className="collapse-button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? '展开导航' : '收起导航'}>
        {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>收起导航</span></>}
      </button>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <IconButton label="打开导航" onClick={() => setMobileOpen(true)}><Menu size={20} /></IconButton>
        <div className="page-title"><span>EIS-DMT</span><strong>/</strong><h1>{title}</h1></div>
        <span className="version-badge">v{config.version}</span>
      </header>
      <main><Outlet /></main>
    </div>
  </div>;
}
