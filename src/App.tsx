import { Navigate, Route, Routes } from 'react-router-dom';
import type { RuntimeConfig } from './domain/types';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { MappingsPage } from './pages/MappingsPage';
import { PlanDetailPage } from './pages/PlanDetailPage';
import { PlansPage } from './pages/PlansPage';
import { PlanWizardPage } from './pages/PlanWizardPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { SettingsPage } from './pages/SettingsPage';
import { VirtualMachinesPage } from './pages/VirtualMachinesPage';

export function App({ config }: { config: RuntimeConfig }) {
  return <Routes>
    <Route element={<AppLayout config={config} />}>
      <Route index element={<DashboardPage />} />
      <Route path="providers" element={<ProvidersPage role="source" />} />
      <Route path="providers/sources" element={<ProvidersPage role="source" />} />
      <Route path="providers/targets" element={<ProvidersPage role="target" />} />
      <Route path="vms" element={<VirtualMachinesPage view="source" />} />
      <Route path="vms/source" element={<VirtualMachinesPage view="source" />} />
      <Route path="vms/target" element={<VirtualMachinesPage view="target" />} />
      <Route path="mappings" element={<MappingsPage />} />
      <Route path="plans" element={<PlansPage />} />
      <Route path="plans/new" element={<PlanWizardPage />} />
      <Route path="plans/:name/edit" element={<PlanWizardPage />} />
      <Route path="plans/:name" element={<PlanDetailPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>;
}
