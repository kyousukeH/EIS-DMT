import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode, SelectHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Info, LoaderCircle, Trash2, TriangleAlert, X } from 'lucide-react';
import type { UiStatus } from '../domain/status';

export function StatusBadge({ tone, children }: PropsWithChildren<{ tone: UiStatus }>) {
  return <span className={`status-badge status-${tone}`}><span className="status-dot" />{children}</span>;
}

export function Button({ variant = 'primary', icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: ReactNode;
}) {
  return <button className={`button button-${variant}`} {...props}>{icon}{children}</button>;
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Select({ className = '', children, ...props }: PropsWithChildren<SelectHTMLAttributes<HTMLSelectElement>>) {
  return <span className={`select-control ${props.disabled ? 'is-disabled' : ''}`}>
    <select className={className} {...props}>{children}</select>
    <ChevronDown className="select-chevron" size={16} aria-hidden="true" />
  </span>;
}

export function Alert({ tone = 'info', title, children }: PropsWithChildren<{
  tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string;
}>) {
  const icons = {
    info: <Info size={18} />, warning: <TriangleAlert size={18} />,
    danger: <AlertCircle size={18} />, success: <CheckCircle2 size={18} />,
  };
  return <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
    <div className="alert-icon">{icons[tone]}</div>
    <div>{title && <strong>{title}</strong>}{children && <div className="alert-content">{children}</div>}</div>
  </div>;
}

export function Modal({ title, description, open, onClose, children, footer, size = 'medium' }: PropsWithChildren<{
  title: string; description?: string; open: boolean; onClose: () => void; footer?: ReactNode; size?: 'medium' | 'large';
}>) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton></header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </section>
  </div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, onClose, onConfirm, pending = false, danger = true, error }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  pending?: boolean;
  danger?: boolean;
  error?: unknown;
}) {
  return <Modal
    open={open}
    onClose={onClose}
    title={title}
    description="请确认本次操作"
    footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>取消</Button><Button variant={danger ? 'danger' : 'primary'} icon={danger ? <Trash2 size={16} /> : undefined} onClick={onConfirm} disabled={pending}>{pending ? '正在处理...' : confirmLabel}</Button></>}
  >
    <div className={`confirm-dialog-message ${danger ? 'is-danger' : 'is-primary'}`}>
      <span className="confirm-dialog-icon">{danger ? <TriangleAlert size={22} /> : <Info size={22} />}</span>
      <div><strong>{danger ? '该操作无法自动撤销' : '操作确认'}</strong><p>{description}</p></div>
    </div>
    {Boolean(error) && <div style={{ marginTop: 14 }}><Alert tone="danger" title="操作失败">{error instanceof Error ? error.message : String(error)}</Alert></div>}
  </Modal>;
}

export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; disabled?: boolean;
}) {
  return <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><span /></span>
  </label>;
}

export function ProgressBar({ value, label, tone = 'normal' }: { value: number; label?: string; tone?: 'normal' | 'danger' | 'success' }) {
  return <div className="progress-wrap">
    <div className="progress-meta"><span>{label}</span><strong>{value}%</strong></div>
    <div className={`progress-track progress-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div style={{ width: `${value}%` }} />
    </div>
  </div>;
}

export function PageState({ loading, error, empty, emptyText = '暂无数据', children }: PropsWithChildren<{
  loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string;
}>) {
  if (loading) return <div className="page-state"><LoaderCircle className="spin" size={24} /><span>正在加载...</span></div>;
  if (error) return <Alert tone="danger" title="数据加载失败">{error instanceof Error ? error.message : String(error)}</Alert>;
  if (empty) return <div className="page-state"><Info size={24} /><span>{emptyText}</span></div>;
  return <>{children}</>;
}

export function Field({ label, required, help, children }: PropsWithChildren<{ label: string; required?: boolean; help?: string }>) {
  return <label className="field"><span className="field-label">{label}{required && <b> *</b>}</span>{children}{help && <small>{help}</small>}</label>;
}

export function formatDate(value?: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
