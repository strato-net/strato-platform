import { Card, Tabs, TabsProps } from "antd";
import { useState } from "react";
import { RenderDeposits } from "../liquidityDeposit/page";
import { RenderWithdraw } from "../liquidityWithdraw/page";
import { motion } from "framer-motion";
import { RefetchPoolProps } from "@/interface/token";

export const RenderLiquidity = ({ refetchPools }: RefetchPoolProps) => {
    type TabKey2 = "deposit" | "withdraw"
    const [activeTab2, setActiveTab2] = useState<TabKey2>("deposit");
    const tabItems: TabsProps["items"] = [
      {
        key: "deposit",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Deposit
          </span>
        ),
      },
      {
        key: "withdraw",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Withdraw
          </span>
        ),
      },
    ];
    return (
      <>
        <motion.div
          className="w-[100%]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="w-full w-[100%] rounded-2xl shadow-lg">
            <Tabs
              items={tabItems}
              activeKey={activeTab2}
              onChange={(k) => setActiveTab2(k as TabKey2)}
              centered
              className="custom-tabs-vibrant"
            />
            <motion.div
              className="mt-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab2 === "deposit"
                ? <RenderDeposits refetchPools={refetchPools} />
                : <RenderWithdraw refetchPools={refetchPools} />}
            </motion.div>
          </Card>
        </motion.div>
      </>
    );
  };