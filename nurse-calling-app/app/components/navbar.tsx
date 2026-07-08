"use client";

import { DarkThemeToggle } from "flowbite-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearUserSession, isSuperAdmin } from "../lib/auth";

export default function TopNavBar() {
  const router = useRouter();
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);

  useEffect(() => {
    setShowSuperAdmin(isSuperAdmin());
  }, []);

  const handleLogout = () => {
    clearUserSession();
    router.push("/login");
  };

  return (
    <nav className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href={showSuperAdmin ? "/super-admin" : "/dashboard"} className="flex items-center">
          <span className="whitespace-nowrap text-2xl font-semibold text-gray-900 dark:text-white">
            Care Call
          </span>
        </Link>

        {/* Center Nav Links */}
        <ul className="flex items-center gap-8">
          {showSuperAdmin ? (
            <>
              <li>
                <Link
                  href="/super-admin"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Super Admin
                </Link>
              </li>
              <li>
                <Link
                  href="/super-admin/logs"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Activity Log
                </Link>
              </li>
            </>
          ) : (
            <>
              <li>
                <Link
                  href="/dashboard"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/reports"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Reports
                </Link>
              </li>
              <li>
                <Link
                  href="/settings"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  Settings
                </Link>
              </li>
            </>
          )}
        </ul>

        {/* Right side items */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleLogout}
            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Logout
          </button>
          <DarkThemeToggle />
        </div>
      </div>
    </nav>
  );
}
