"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "@/context/AuthContext";

interface NavbarProps {
  onStartTour?: () => void;
}

export default function Navbar({ onStartTour }: NavbarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { user, logout, isAdmin, isUser } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Strict role-based navigation links
  let navLinks: { label: string; href: string }[] = [];

  if (isAdmin) {
    // Admin sees strictly administrative views
    navLinks = [
      { label: "Admin Console", href: "/admin" },
      { label: "Pipeline Diagnostics", href: "/admin#diagnostics" },
    ];
  } else if (isUser) {
    // Standard user sees strictly consumer views
    navLinks = [
      { label: "Overview", href: "/" },
      { label: "User Console", href: "/portal" },
      { label: "Profile", href: "/profile" },
    ];
  } else {
    // Unauthenticated visitors
    navLinks = [
      { label: "Overview", href: "/" },
    ];
  }

  const handleNavClick = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <header
      className="sticky top-0 z-40 w-full border-b backdrop-blur-md transition-colors duration-200"
      style={{
        backgroundColor: "color-mix(in srgb, var(--bg-page) 88%, transparent)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Wordmark */}
        <div className="flex items-center gap-8">
          <Link href={isAdmin ? "/admin" : "/"} className="group flex items-center gap-2.5 sm:gap-3" onClick={handleNavClick}>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg border font-serif text-base font-semibold tracking-tight transition-transform group-hover:scale-105"
              style={{
                borderColor: "var(--border-default)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--accent)",
              }}
            >
              C
            </span>
            <div className="flex flex-col">
              <span className="font-serif text-base sm:text-lg font-medium tracking-tight text-[var(--text-primary)]">
                ClaimSpace
              </span>
              <span className="text-[9px] sm:text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {isAdmin ? "Admin Workstation" : "Spatial Claims & 3D"}
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`btn-squish rounded-md px-3 py-1.5 text-xs font-medium tracking-normal transition-colors ${
                    isActive
                      ? "text-[var(--text-primary)] font-semibold"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                  }`}
                  style={{
                    backgroundColor: isActive ? "var(--bg-surface)" : "transparent",
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Guided Tour Link / Action: When on /tour, renders the single Start Guided Tour button at the top */}
          {!isAdmin && (
            pathname === "/tour" ? (
              <button
                type="button"
                id="tour-start-btn"
                onClick={onStartTour}
                className="btn-squish inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all"
                style={{
                  backgroundColor: "var(--accent)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                <span>Start Guided Tour</span>
              </button>
            ) : (
              <Link
                href="/tour"
                className="btn-squish hidden sm:inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border-default)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse"></span>
                Start Guided Tour
              </Link>
            )
          )}

          {/* Theme Switcher Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            onClick={toggleTheme}
            className="btn-squish relative inline-flex h-7 w-[54px] shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] hover:border-[var(--border-strong)]"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            {/* Background track icons */}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-between px-1.5">
              <svg
                className={`h-3.5 w-3.5 transition-opacity duration-200 ${
                  theme === "light" ? "opacity-0" : "text-[var(--text-muted)] opacity-60"
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>

              <svg
                className={`h-3.5 w-3.5 transition-opacity duration-200 ${
                  theme === "dark" ? "opacity-0" : "text-[var(--text-muted)] opacity-60"
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </span>

            {/* Sliding Thumb Knob */}
            <span
              className={`pointer-events-none flex h-[22px] w-[22px] transform items-center justify-center rounded-full shadow-sm border transition-transform duration-200 ease-in-out ${
                theme === "dark" ? "translate-x-[26px]" : "translate-x-0"
              }`}
              style={{
                backgroundColor: "var(--bg-card)",
                borderColor: "var(--border-default)",
              }}
            >
              {theme === "light" ? (
                <svg
                  className="h-3.5 w-3.5 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  className="h-3.5 w-3.5 text-sky-400 dark:text-sky-300"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </span>
          </button>

          {/* User Status / Account Dropdown or Sign In */}
          {user ? (
            <div className="hidden xs:inline-flex sm:inline-flex items-center gap-2">
              {/* Role Badge */}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold border ${
                  isAdmin
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                }`}
              >
                {isAdmin ? "Admin" : "User"}
              </span>

              {/* User Email / Name */}
              <span className="text-xs font-medium text-[var(--text-secondary)] truncate max-w-[120px]">
                {user.full_name || user.email.split("@")[0]}
              </span>

              {/* Sign Out Button */}
              <button
                onClick={logout}
                className="btn-squish text-xs px-2.5 py-1 rounded-md border border-[var(--border-default)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                title="Sign out of ClaimSpace"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="btn-squish hidden xs:inline-flex sm:inline-flex items-center justify-center rounded-md px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all"
              style={{
                backgroundColor: "var(--accent)",
              }}
            >
              Sign In
            </Link>
          )}

          {/* Mobile Hamburger Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-expanded={isMobileMenuOpen}
            aria-label="Toggle navigation menu"
            className="btn-squish md:hidden flex h-9 w-9 items-center justify-center rounded-md border text-[var(--text-primary)] transition-colors"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            {isMobileMenuOpen ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden border-t px-4 py-4 space-y-3 animate-drawer-down transition-colors duration-200"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: "var(--border-subtle)",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          }}
        >
          {/* User info banner on mobile if logged in */}
          {user && (
            <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-[var(--text-primary)]">{user.full_name || user.email}</span>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">{user.email}</span>
              </div>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border ${
                  isAdmin
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                }`}
              >
                {isAdmin ? "Admin" : "User"}
              </span>
            </div>
          )}

          {/* Navigation Links */}
          <nav className="flex flex-col space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={handleNavClick}
                  className={`btn-squish flex items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "text-[var(--accent)] font-semibold bg-[var(--accent-subtle)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  <span>{link.label}</span>
                  {isActive && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Quick Actions Strip */}
          <div className="pt-2 border-t flex flex-col gap-2" style={{ borderColor: "var(--border-subtle)" }}>
            {!isAdmin && (
              pathname === "/tour" ? (
                <button
                  type="button"
                  onClick={() => {
                    handleNavClick();
                    if (onStartTour) onStartTour();
                  }}
                  className="btn-squish w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold text-white transition-all"
                  style={{
                    backgroundColor: "var(--accent)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  <span>Start Guided Tour</span>
                </button>
              ) : (
                <Link
                  href="/tour"
                  onClick={handleNavClick}
                  className="btn-squish w-full flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium text-[var(--text-primary)]"
                  style={{
                    backgroundColor: "var(--bg-card)",
                    borderColor: "var(--border-default)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse"></span>
                  Start Guided Tour
                </Link>
              )
            )}

            {user ? (
              <button
                onClick={() => {
                  handleNavClick();
                  logout();
                }}
                className="btn-squish w-full flex items-center justify-center rounded-lg py-2.5 text-xs font-semibold text-red-500 border border-red-500/20 hover:bg-red-500/10 transition-colors"
              >
                Sign Out
              </button>
            ) : (
              <Link
                href="/login"
                onClick={handleNavClick}
                className="btn-squish w-full flex items-center justify-center rounded-lg py-2.5 text-xs font-semibold text-white shadow-sm"
                style={{
                  backgroundColor: "var(--accent)",
                }}
              >
                Sign In to Account
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
