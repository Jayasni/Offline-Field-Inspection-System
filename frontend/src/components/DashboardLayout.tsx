
import type { ReactNode } from "react";
import Sidebar from "./Sidebar";

type LayoutProps = {
  user: {
    role: string;
    full_name: string;
  };
  activePage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  children: ReactNode;
};

export default function DashboardLayout({
  user,
  activePage,
  onNavigate,
  onLogout,
  children
}: LayoutProps) {
  return (
    <div className="dashboard-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        role={user.role}
        onLogout={onLogout}
      />

      <main className="dashboard-main">
        <header className="top-header">
          <div>
            <h2>{activePage}</h2>
            <p>Welcome back, {user.full_name}</p>
          </div>

          <div className="header-right">
            <span className="online-indicator">
              ● {navigator.onLine ? "Online" : "Offline"}
            </span>

            <div className="header-avatar">
              {user.full_name?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {children}
        </div>
      </main>
    </div>
  );
}
