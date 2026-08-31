"use client";

import { DarkThemeToggle } from "flowbite-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearUserSession, isSuperAdmin } from "../lib/auth";
import { scopeFromOptionValue, scopeToOptionValue, useScope, useScopeOptions } from "../lib/scope";

export default function TopNavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setShowSuperAdmin(isSuperAdmin());
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    clearUserSession();
    router.push("/login");
  };

  const userLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/reports", label: "Reports" },
    { href: "/settings", label: "Settings" },
  ];

  const adminLinks = [
    { href: "/super-admin/organisations", label: "Organisations" },
    { href: "/super-admin/users", label: "Users" },
    { href: "/super-admin/logs", label: "Activity Log" },
  ];

  const links = showSuperAdmin ? adminLinks : userLinks;
  const homeHref = showSuperAdmin ? "/super-admin/organisations" : "/dashboard";

  // The app-wide device/floor scope lives here so one pick follows the user
  // across Dashboard, Reports and Settings. Hidden for a super admin, who works
  // across organisations rather than inside one, and for a site with a single
  // device and floor, where there is nothing to choose between.
  const [scope, setScope] = useScope("primary");
  const scopeOptions = useScopeOptions();
  const showScopePicker =
    !showSuperAdmin &&
    !scopeOptions.isLoading &&
    (scopeOptions.hids.length > 1 || scopeOptions.floors.length > 1);

  const linkClass = (href: string, compact = false) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return `rounded-xl text-sm font-medium transition ${
      compact ? "px-3 py-2 whitespace-nowrap" : "px-3 py-2.5"
    } ${
      active
        ? "bg-teal-700 text-white"
        : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
    }`;
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm">
            CC
          </span>
          <span className="truncate text-lg font-semibold tracking-tight text-gray-900 dark:text-white sm:text-xl">
            Care Call
          </span>
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={linkClass(link.href)}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleLogout}
            className="hidden rounded-xl px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 sm:inline-flex"
          >
            Logout
          </button>
          <DarkThemeToggle />
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-white md:hidden"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {showScopePicker && (
        <div className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-800">
          <label
            htmlFor="scope-picker"
            className="text-sm font-medium text-gray-600 dark:text-gray-400"
          >
            SELECT FLOOR/HID
          </label>
          <select
            id="scope-picker"
            value={scopeToOptionValue(scope)}
            onChange={(e) => setScope(scopeFromOptionValue(e.target.value))}
            className="max-w-[16rem] rounded-xl border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-900 focus:border-teal-600 focus:ring-teal-600 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All devices</option>
            {scopeOptions.hids.length > 0 && (
              <optgroup label="HID">
                {scopeOptions.hids.map((hid) => (
                  <option key={`hid:${hid}`} value={`hid:${hid}`}>
                    {hid}
                  </option>
                ))}
              </optgroup>
            )}
            {scopeOptions.floors.length > 0 && (
              <optgroup label="Floor">
                {scopeOptions.floors.map((floor) => (
                  <option key={`floor:${floor}`} value={`floor:${floor}`}>
                    Floor {floor}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      {/* Mobile: page links always visible at top */}
      <div className="border-t border-gray-100 px-3 pb-3 pt-1 dark:border-gray-800 md:hidden">
        <ul className="-mx-1 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((link) => (
            <li key={link.href} className="shrink-0">
              <Link href={link.href} className={`block ${linkClass(link.href, true)}`}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {menuOpen && (
        <div className="border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900 md:hidden">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={`block ${linkClass(link.href)}`}>
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-1 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Logout
              </button>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}
