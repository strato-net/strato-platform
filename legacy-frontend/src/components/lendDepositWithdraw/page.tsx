import { Card, Tabs, TabsProps } from "antd";
import { RenderLendDeposit } from "../lendDeposit/page";
import { RenderLendWithdraw } from "../lendWithdraw/page";
import { motion } from "framer-motion";
import { useState } from "react";
import { ChildComponentProps } from "@/interface/token";

type TabKey3 = "deposit" | "withdraw";

export const RenderLendDepositWithdraw = ({ dashboardRef }: ChildComponentProps) => {
    const [activeTab3, setActiveTab3] = useState<TabKey3>("deposit");
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
        <div className="w-full">
            <Card className="w-full rounded-2xl shadow-lg">
                <Tabs
                    items={tabItems}
                    activeKey={activeTab3}
                    onChange={(k) => setActiveTab3(k as TabKey3)}
                    centered
                    className="custom-tabs-vibrant"
                />
                <motion.div
                    className="mt-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                >
                    {activeTab3 === "deposit" ? (
                        <RenderLendDeposit dashboardRef={dashboardRef} />
                    ) : (
                        <RenderLendWithdraw dashboardRef={dashboardRef}/>
                    )}
                </motion.div>
            </Card>
        </div>
    );
};