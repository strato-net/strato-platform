"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CancelPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    const listingId = searchParams.get("listingId");

    if (!listingId) {
      setStatus("error");
      setTimeout(() => router.push("/buy"), 2500);
      return;
    }

    fetch("/api/onramp/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId }),
    })
      .then((res) => {
        if (res.ok) {
          setStatus("success");
          setTimeout(() => router.push("/"), 2000);
        } else {
          setStatus("error");
          setTimeout(() => router.push("/buy"), 2500);
        }
      })
      .catch(() => {
        setStatus("error");
        setTimeout(() => router.push("/buy"), 2500);
      });
  }, [searchParams, router]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">Payment Cancelled</h2>
      {status === "idle" && <p>Releasing locked tokens...</p>}
      {status === "success" && <p>Tokens released. Redirecting...</p>}
      {status === "error" && (
        <p className="text-red-600">
          Failed to release lock. Redirecting to listings...
        </p>
      )}
    </div>
  );
}
