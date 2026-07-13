"use client";

import TopNavBar from "../../components/navbar";
import SuperAdminSubNav from "./SuperAdminSubNav";
import { useSuperAdminGuard } from "../lib/use-super-admin-guard";
import { Spinner } from "flowbite-react";

type SuperAdminShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export default function SuperAdminShell({ title, description, children }: SuperAdminShellProps) {
  const isReady = useSuperAdminGuard();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-900">
        <Spinner size="xl" />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <TopNavBar />
      <div className="page-container">
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
            )}
          </div>
          <SuperAdminSubNav />
          {children}
        </div>
      </div>
    </div>
  );
}
