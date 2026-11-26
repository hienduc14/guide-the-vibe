import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ToastProvider } from "./hooks/useToast";
import { OverviewProvider } from "./hooks/useOverview";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/login/LoginPage";
import { OverviewPage } from "./pages/overview/OverviewPage";
import { ManagerOnly, ProjectLayout } from "./pages/project/ProjectLayout";
import { NowPage } from "./pages/project/NowPage";
import { InboxPage } from "./pages/project/InboxPage";
import { WorkPage } from "./pages/project/WorkPage";
import { TalkPage } from "./pages/project/TalkPage";
import { KnowledgePage } from "./pages/project/KnowledgePage";
import { SettingsPage } from "./pages/project/SettingsPage";
import { BrainPage } from "./pages/brain/BrainPage";
import { DevsPage } from "./pages/devs/DevsPage";
import { UsersPage } from "./pages/users/UsersPage";
import { ShareEntry } from "./pages/share/ShareEntry";

/** Redirect inside a project, keeping the query (e.g. ?task=…). */
function Moved({ to, extra }: { to: string; extra?: string }) {
  const { id } = useParams();
  const { search } = useLocation();
  const q = [search.replace(/^\?/, ""), extra].filter(Boolean).join("&");
  return <Navigate to={`/p/${id}${to ? `/${to}` : ""}${q ? `?${q}` : ""}`} replace />;
}

function Gate() {
  const { needsLogin } = useAuth();
  if (needsLogin) return <LoginPage />;
  return (
    <OverviewProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="p/:id" element={<ProjectLayout />}>
            <Route index element={<NowPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="work" element={<WorkPage />} />
            <Route path="talk" element={<TalkPage />} />
            <Route path="knowledge/:section?" element={<KnowledgePage />} />
            <Route
              path="settings/:section?"
              element={
                <ManagerOnly>
                  <SettingsPage />
                </ManagerOnly>
              }
            />
            {/* Old addresses, kept so shared links still land somewhere sensible. */}
            <Route path="board" element={<Moved to="work" />} />
            <Route path="stats" element={<Moved to="work" extra="view=progress" />} />
            <Route path="conversations" element={<Moved to="talk" />} />
            <Route path="conflicts" element={<Moved to="inbox" />} />
            <Route path="qa" element={<Moved to="inbox" />} />
            <Route path="members" element={<Moved to="settings/members" />} />
            <Route path="layers" element={<Moved to="settings/watch" />} />
            <Route path="graph" element={<Moved to="" />} />
            <Route path="*" element={<Moved to="" />} />
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
