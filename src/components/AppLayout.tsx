import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity, Boxes, ChevronLeft, ChevronRight, Gauge, GitBranch, Menu, Monitor,
  Network, Server, Settings, ShieldCheck, Waypoints, X,
} from 'lucide-react';
import type { RuntimeConfig } from '../domain/types';
import { IconButton } from './ui';

const workflowNav = [
  {
    label: '准备迁移环境', icon: Boxes,
    items: [
      { to: '/providers/sources', label: '连接源集群', icon: Server, step: '01', end: true },
      { to: '/providers/targets', label: '添加目标集群', icon: ShieldCheck, step: '02', end: true },
    ],
  },
  {
    label: '准备迁移资源', icon: Network,
    items: [
      { to: '/vms/source', label: '源集群虚拟机', icon: Monitor, step: '03', end: true },
      { to: '/mappings', label: '配置网络与存储', icon: Waypoints, step: '04', end: false },
    ],
  },
  {
    label: '执行与查看', icon: GitBranch,
    items: [
      { to: '/plans', label: '创建与执行迁移', icon: GitBranch, step: '05', end: false },
      { to: '/vms/target', label: '查看迁移结果', icon: Monitor, end: true },
    ],
  },
];

const titles: Record<string, string> = {
  '/': '迁移总览', '/vms': '源集群虚拟机', '/vms/source': '源集群虚拟机', '/vms/target': '目标集群虚拟机',
  '/providers': '源集群', '/providers/sources': '源集群', '/providers/targets': '目标集群', '/mappings': '网络与存储配置',
  '/plans': '迁移计划', '/plans/new': '创建迁移计划', '/settings': '系统设置',
};

export function AppLayout({ config }: { config: RuntimeConfig }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = location.pathname.endsWith('/edit')
    ? '编辑迁移计划'
    : location.pathname.startsWith('/plans/') && location.pathname !== '/plans/new'
      ? '迁移详情' : titles[location.pathname] || 'EIS-DMT';

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
          <div className="nav-flow-items">{section.items.map(({ to, label, icon: Icon, step, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined}>
            <span className="nav-flow-icon"><Icon size={16} /></span><span className="nav-flow-label">{label}</span>{step && <small>{step}</small>}
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
