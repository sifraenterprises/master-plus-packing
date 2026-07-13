import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import DashboardHome from "@/pages/DashboardHome";
import MasterDispatch from "@/pages/MasterDispatch";
import CreateDispatch from "@/pages/master-dispatch/CreateDispatch";
import DispatchList from "@/pages/master-dispatch/DispatchList";
import BulkUpload from "@/pages/master-dispatch/BulkUpload";
import SearchDispatch from "@/pages/master-dispatch/SearchDispatch";
import ModulePlaceholder from "@/pages/ModulePlaceholder";
import PackingModule from "@/pages/PackingModule";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";

function Protected({ children, adminOnly = false }) {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="auth-loading">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (user === false) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/portal" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <div className="grain-overlay" aria-hidden="true" />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/portal"
            element={
              <Protected>
                <PortalLayout />
              </Protected>
            }
          >
            <Route index element={<DashboardHome />} />
            <Route path="dispatch" element={<MasterDispatch />} />
            <Route path="master-dispatch/create" element={<CreateDispatch />} />
            <Route path="master-dispatch/list" element={<DispatchList />} />
            <Route path="master-dispatch/bulk" element={<BulkUpload />} />
            <Route path="master-dispatch/search" element={<SearchDispatch />} />
            <Route path="reports" element={<Reports />} />
            <Route path="modules/packing" element={<PackingModule />} />
            <Route path="modules/:moduleKey" element={<ModulePlaceholder />} />
            <Route
              path="settings"
              element={
                <Protected adminOnly>
                  <Settings />
                </Protected>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
