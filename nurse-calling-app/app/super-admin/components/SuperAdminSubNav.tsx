"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/super-admin/organisations", label: "Organisations", exact: true },
  { href: "/super-admin/organisations/create", label: "Create Organisation", exact: true },
  { href: "/super-admin/users", label: "Users", exact: true },
  { href: "/super-admin/logs", label: "Activity Log", exact: true },
];

function isActive(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SuperAdminSubNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 border-b border-gray-200 pb-4 dark:border-gray-700">
      {links.map((link) => {
        const active = isActive(pathname, link.href, link.exact);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
