import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";

const SyncingPage = () => {
  usePageTitle("Syncing");

  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-lg mx-auto p-8">
        <div className="mb-8">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-muted"></div>
            <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          Node Syncing{dots}
        </h1>
        <p className="text-lg text-muted-foreground mb-6">
          The blockchain node is currently synchronizing data from the network.
        </p>
        <p className="text-sm text-muted-foreground">
          This page will automatically refresh when the node is ready.
        </p>
      </div>
    </div>
  );
};

export default SyncingPage;
