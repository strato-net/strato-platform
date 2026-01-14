import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { SenderFlow } from "@/components/refer/SenderFlow";
import { useUser } from "@/context/UserContext";

const ReferFriend = () => {
  const { userName } = useUser();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    document.title = "Refer a Friend | STRATO";
  }, []);

  // TODO: These should be fetched from backend or configured via constants
  const escrowContractName = "Escrow";
  const escrowContractAddressNo0x = "7fa32d329b5f61a1808418304eea249b1b0b28fc"; // TODO: Add actual escrow contract address

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader 
          title="Refer a Friend" 
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />
        <main className="p-6">
          <div className="max-w-4xl mx-auto">
            <SenderFlow
              senderUsername={userName || "User"}
              escrowContractName={escrowContractName}
              escrowContractAddressNo0x={escrowContractAddressNo0x}
              claimPath="/claim"
            />
          </div>
        </main>
      </div>
    </div>
  );
};

export default ReferFriend;

