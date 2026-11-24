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
import { MembersTab } from "./pages/project/MembersTab";
import { BoardTab } from "./pages/project/BoardTab";
import { ConversationsTab } from "./pages/project/ConversationsTab";
import { BrainPage } from "./pages/brain/BrainPage";
import { DevsPage } from "./pages/devs/DevsPage";
import { UsersPage } from "./pages/users/UsersPage";
import { ShareEntry } from "./pages/share/ShareEntry";

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
            <Route path="board" element={<BoardTab />} />
            <Route path="conversations" element={<ConversationsTab />} />
            <Route path="members" element={<MembersTab />} />
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
          <Route path="users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </OverviewProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:code" element={<ShareEntry />} />
        <Route
          path="*"
          element={
            <AuthProvider>
              <ToastProvider>
                <Gate />
              </ToastProvider>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
