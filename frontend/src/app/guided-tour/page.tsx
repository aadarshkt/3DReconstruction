"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GuidedTourRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/tour");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center font-mono text-xs text-[var(--text-muted)]">
      Redirecting to Guided Tour...
    </div>
  );
}
