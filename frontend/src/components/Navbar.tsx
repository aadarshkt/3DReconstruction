"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";

interface NavbarProps {
  onStartTour?: () => void;
}

export default function Navbar({ onStartTour }: NavbarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: "Overview", href: "/" },
    { label: "User Console", href: "/portal" },
    { label: "Profile", href: "/profile" },
    { label: "Admin Console", href: "/admin" },
  ];

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
          <Link href="/" className="group flex items-center gap-2.5 sm:gap-3" onClick={handleNavClick}>
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
                Spatial Claims & 3D
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
          {/* Guided Tour Link (Desktop/Tablet) */}
          <Link
            href="/tour"
            className="btn-squish hidden sm:inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
            style={{
              backgroundColor: pathname === "/tour" ? "var(--bg-surface)" : "var(--bg-card)",
              borderColor: pathname === "/tour" ? "var(--accent)" : "var(--border-default)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse"></span>
            Guided Tour
          </Link>

          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="btn-squish flex items-center justify-center rounded-md border px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <span className="text-[11px] font-mono uppercase tracking-wider">
              {theme === "light" ? "Light" : "Dark"}
            </span>
          </button>

          {/* Sign In / Account (Desktop) */}
          <Link
            href="/login"
            className="btn-squish hidden xs:inline-flex sm:inline-flex items-center justify-center rounded-md px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all"
            style={{
              backgroundColor: "var(--accent)",
            }}
          >
            Sign In
          </Link>

          {/* Mobile Hamburger Menu Toggle Button (Mobile only) */}
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
              // Close 'X' icon
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              // 3-line hamburger icon
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer / Dropdown */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden border-t px-4 py-4 space-y-3 animate-drawer-down transition-colors duration-200"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: "var(--border-subtle)",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          }}
        >
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
            <Link
              href="/tour"
              onClick={handleNavClick}
              className="btn-squish w-full flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium text-[var(--text-primary)]"
              style={{
                backgroundColor: pathname === "/tour" ? "var(--bg-surface)" : "var(--bg-card)",
                borderColor: pathname === "/tour" ? "var(--accent)" : "var(--border-default)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse"></span>
              Guided Tour
            </Link>

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
          </div>
        </div>
      )}
    </header>
  );
}
