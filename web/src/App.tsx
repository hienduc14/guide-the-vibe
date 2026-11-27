import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { WaitingProvider } from "./hooks/useWaiting";
import { ToastProvider } from "./hooks/useToast";
import { OverviewProvider } from "./hooks/useOverview";
import { Layout } from "./components/Layout";
import { JoinGuestPage, LoginPage, ResetPage, SetupPage, SignupPage } from "./pages/auth/GatePages";
import { HomePage } from "./pages/home/HomePage";
import { ProjectLayout } from "./pages/project/ProjectLayout";
import { NowPage } from "./pages/project/NowPage";
import { InboxPage } from "./pages/project/InboxPage";
import { WorkPage } from "./pages/project/WorkPage";
import { TalkPage } from "./pages/project/TalkPage";
import { KnowledgePage } from "./pages/project/KnowledgePage";
import { SettingsPage } from "./pages/project/SettingsPage";
import { AccountPage, ConnectPage, DevicesPage, JoinPage } from "./pages/account/AccountPages";
import { AdminAiPage, AdminRegistrationPage, AdminUsersPage } from "./pages/admin/AdminPages";
import { ShareEntry } from "./pages/share/ShareEntry";

/** Redirect inside a project, keeping the query (e.g. ?task=…). */
function Moved({ to, extra }: { to: string; extra?: string }) {
  const { id } = useParams();
  const { search } = useLocation();
  const q = [search.replace(/^\?/, ""), extra].filter(Boolean).join("&");
  return <Navigate to={`/p/${id}${to ? `/${to}` : ""}${q ? `?${q}` : ""}`} replace />;
}

/** Back to ?next= (a path on this site) once logged in. */
function ToNext() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  return <Navigate to={next.startsWith("/") && !next.startsWith("//") ? next : "/"} replace />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return me?.role === "admin" ? <>{children}</> : <Navigate to="/" replace />;
}

/** Everything behind the login: the rail and its pages. */
function Shell() {
  return (
    <OverviewProvider>
      <WaitingProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="new" element={<HomePage />} />
            <Route path="p/:id" element={<ProjectLayout />}>
              <Route index element={<NowPage />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="work" element={<WorkPage />} />
              <Route path="talk" element={<TalkPage />} />
              <Route path="knowledge/:section?" element={<KnowledgePage />} />
              <Route path="settings/:section?" element={<SettingsPage />} />
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
            <Route path="join/:code" element={<JoinPage />} />
            <Route path="connect" element={<ConnectPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="account/devices" element={<DevicesPage />} />
            <Route path="me" element={<Navigate to="/account" replace />} />
            <Route path="admin" element={<AdminOnly children={<AdminUsersPage />} />} />
            <Route path="admin/registration" element={<AdminOnly children={<AdminRegistrationPage />} />} />
            <Route path="admin/ai" element={<AdminOnly children={<AdminAiPage />} />} />
            <Route path="brain" element={<Navigate to="/admin/ai" replace />} />
            <Route path="people" element={<Navigate to="/admin" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </WaitingProvider>
    </OverviewProvider>
  );
}

/** Picks the gate (setup, login, sign-up, reset, an invite for guests) or the app, from the server's answers. */
function Root() {
  const { config, me } = useAuth();
  const { pathname, search } = useLocation();
  if (!config || me === undefined) return null;
  if (config.setup_needed) return <SetupPage />;
  if (!me)
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset/:code" element={<ResetPage />} />
        <Route path="/join/:code" element={<JoinGuestPage />} />
        <Route path="*" element={<Navigate to={pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname + search)}`} replace />} />
      </Routes>
    );
  return (
    <Routes>
      <Route path="/login" element={<ToNext />} />
      <Route path="/signup" element={<ToNext />} />
      <Route path="/reset/:code" element={<ResetPage />} />
      <Route path="*" element={<Shell />} />
    </Routes>
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
                <Root />
              </ToastProvider>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
