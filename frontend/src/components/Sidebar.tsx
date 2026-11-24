
import type { ReactNode } from "react";


type SidebarProps = {
  activePage: string;
  onNavigate: (page: string) => void;
  role: string;
  onLogout: () => void;
};

type MenuItem = {
  label: string;
  icon: string;
};

// ADMIN MENU - CORE REQUIREMENTS ONLY
const adminItems: MenuItem[] = [
  { label: "Dashboard", icon: "🏠" },
  { label: "User Management", icon: "👥" },
  { label: "Assignments", icon: "📝" },
  { label: "Inspection Management", icon: "🔍" },
  { label: "Sync Management", icon: "🔄" }
];

// FIELD STAFF MENU - EXISTING FEATURES PRESERVED
const staffItems: MenuItem[] = [
  { label: "Dashboard", icon: "🏠" },
  { label: "My Assignments", icon: "📋" },
  { label: "Offline Records", icon: "💾" },
  { label: "Sync Management", icon: "🔄" },
  { label: "Notifications", icon: "🔔" },
  { label: "Settings", icon: "⚙️" }
];

export default function Sidebar({
  activePage,
  onNavigate,
  role,
  onLogout
}: SidebarProps) {
  const isAdmin = role === "admin_supervisor";
  const menuItems = isAdmin ? adminItems : staffItems;

  return (
    <aside className="app-sidebar">

      {/* BRAND */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">FI</div>

        <div>
          <h2>Field Inspection</h2>
          <span>
            {isAdmin ? "Administrator" : "Field Staff"}
          </span>
        </div>
      </div>

      {/* NAVIGATION */}
      <nav className="sidebar-nav">
        <p className="sidebar-label">MAIN MENU</p>

        {menuItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`sidebar-item ${
              activePage === item.label ? "active" : ""
            }`}
            onClick={() => onNavigate(item.label)}
            aria-current={
              activePage === item.label ? "page" : undefined
            }
          >
            <span className="sidebar-icon">
              {item.icon}
            </span>

            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* LOGOUT */}
      <div className="sidebar-bottom">
        <button
          type="button"
          className="sidebar-logout"
          onClick={onLogout}
        >
          <span className="sidebar-icon">🚪</span>
          <span>Logout</span>
        </button>
      </div>

    </aside>
  );
}
