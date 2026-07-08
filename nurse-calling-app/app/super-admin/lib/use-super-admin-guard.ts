"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken, getStoredUser, isSuperAdmin } from "../../lib/auth";

export function useSuperAdminGuard() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    const token = getAuthToken();
    if (!user || !token || !isSuperAdmin()) {
      router.replace("/login");
      return;
    }
    setIsReady(true);
  }, [router]);

  return isReady;
}
