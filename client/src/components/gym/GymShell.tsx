import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  UserRound,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { roleLabels, type GymRole } from "@shared/gym";

type View =
  | "dashboard"
  | "members"
  | "plans"
  | "attendance"
  | "billing"
  | "training"
  | "reports"
  | "retention"
  | "team"
  | "settings"
  | "portal";
const items: Array<{
  id: View;
  label: string;
  icon: LucideIcon;
  roles: GymRole[];
}> = [
  {
    id: "dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    roles: ["owner", "admin", "receptionist", "trainer"],
  },
  {
    id: "members",
    label: "Members",
    icon: Users,
    roles: ["owner", "admin", "receptionist", "trainer"],
  },
  {
    id: "plans",
    label: "Plans & renewals",
    icon: ClipboardList,
    roles: ["owner", "admin", "receptionist"],
  },
  {
    id: "attendance",
    label: "Check-in",
    icon: Activity,
    roles: ["owner", "admin", "receptionist"],
  },
  {
    id: "billing",
    label: "Billing",
    icon: CircleDollarSign,
    roles: ["owner", "admin", "receptionist"],
  },
  {
    id: "training",
    label: "Training",
    icon: Dumbbell,
    roles: ["owner", "admin", "trainer"],
  },
  {
    id: "reports",
    label: "Reports & expenses",
    icon: ChartNoAxesCombined,
    roles: ["owner", "admin"],
  },
  {
    id: "retention",
    label: "Retention",
    icon: Bell,
    roles: ["owner", "admin", "receptionist"],
  },
  {
    id: "team",
    label: "Team & access",
    icon: Shield,
    roles: ["owner", "admin"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    roles: ["owner", "admin"],
  },
  { id: "portal", label: "My membership", icon: UserRound, roles: ["member"] },
];

export function GymShell({
  role,
  gymName,
  userName,
  active,
  onNavigate,
  onLogout,
  children,
}: {
  role: GymRole;
  gymName: string;
  userName: string;
  active: View;
  onNavigate: (view: View) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const available = items.filter(item => item.roles.includes(role));
  const current = available.find(item => item.id === active);
  const navigate = (view: View) => {
    onNavigate(view);
    setOpen(false);
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar${open ? " sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-symbol" aria-hidden="true">
            <Zap size={19} strokeWidth={2.4} />
          </div>
          <div>
            <strong>FIT CRUSH</strong>
            <small>GYM MANAGEMENT SOFTWARE</small>
          </div>
          <button
            className="mobile-close icon-button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="branch-chip">
          <span className="live-dot" /> SINGLE BRANCH{" "}
          <span className="branch-code">01</span>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <p className="nav-section-label">WORKSPACE</p>
          {available.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item${active === item.id ? " nav-active" : ""}`}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === "retention" && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-mark">S</span>
            <div>
              <strong>Every visit, accounted for.</strong>
              <small>
                Front desk ·{" "}
                {new Intl.DateTimeFormat("en-IN", {
                  timeZone: "Asia/Kolkata",
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                }).format(new Date())}
              </small>
            </div>
          </div>
          <button className="sidebar-user" onClick={onLogout}>
            <span className="user-avatar">
              {userName.trim().charAt(0).toUpperCase() || "S"}
            </span>
            <span className="sidebar-user-text">
              <strong>{userName || "Gym staff"}</strong>
              <small>{roleLabels[role] ?? role}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="nav-scrim"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        />
      )}
      <main className="main-area">
        <div className="mobile-topbar">
          <button
            className="icon-button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="mobile-brand">
            <span className="brand-symbol mini" aria-hidden="true">
              <Zap size={15} strokeWidth={2.4} />
            </span>
            <strong>FIT CRUSH</strong>
          </div>
          <span className="role-pill">{roleLabels[role]}</span>
        </div>
        <header className="topbar">
          <div className="breadcrumb">
            <span>{gymName || "Fit Crush"}</span>
            <span className="crumb-slash">/</span>
            <strong>{current?.label ?? "Management"}</strong>
          </div>
          <div className="topbar-meta">
            <span className="open-status">
              <i /> System active
            </span>
            <span className="topbar-date">
              {new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                weekday: "short",
                day: "2-digit",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </span>
            <span className="topbar-avatar">
              {userName.trim().charAt(0).toUpperCase() || "S"}
            </span>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

import React from "react";
export type { View as GymView };
