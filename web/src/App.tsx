import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ToastProvider } from "./hooks/useToast";
import { OverviewProvider } from "./hooks/useOverview";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/login/LoginPage";
import { OverviewPage } from "./pages/overview/OverviewPage";
import { ProjectLayout } from "./pages/project/ProjectLayout";
import { ProjectOverview } from "./pages/project/ProjectOverview";
import { ConflictsTab } from "./pages/project/ConflictsTab";
import { LayersTab } from "./pages/project/LayersTab";
import { TicketsTab } from "./pages/project/TicketsTab";
import { KnowledgeTab } from "./pages/project/KnowledgeTab";
import { GraphTab } from "./pages/project/GraphTab";
import { StatsTab } from "./pages/project/StatsTab";
import { SettingsTab } from "./pages/project/SettingsTab";
import { BrainPage } from "./pages/brain/BrainPage";
import { DevsPage } from "./pages/devs/DevsPage";

function Gate() {
  const { needsLogin } = useAuth();
  if (needsLogin) return <LoginPage />;
  return (
    <OverviewProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="p/:id" element={<ProjectLayout />}>
            <Route index element={<ProjectOverview />} />
            <Route path="conflicts" element={<ConflictsTab />} />
            <Route path="layers" element={<LayersTab />} />
            <Route path="qa" element={<TicketsTab />} />
            <Route path="knowledge" element={<KnowledgeTab />} />
            <Route path="graph" element={<GraphTab />} />
            <Route path="stats" element={<StatsTab />} />
            <Route path="settings" element={<SettingsTab />} />
          </Route>
          <Route path="brain" element={<BrainPage />} />
          <Route path="devs" element={<DevsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </OverviewProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
