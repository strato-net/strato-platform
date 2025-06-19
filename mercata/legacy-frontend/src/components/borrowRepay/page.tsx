import { Card, Tabs, TabsProps } from "antd";
import { RenderBorrow } from "../borrow/page";
import { RenderRepay } from "../repay/page";
import { motion } from "framer-motion";
import { useState } from "react";
import { ChildComponentProps } from "@/interface/token";

type TabKey2 = "borrow" | "repay";

export const RenderBorrowRepay = ({ dashboardRef }: ChildComponentProps) => {
    const [activeTab2, setActiveTab2] = useState<TabKey2>("borrow");
    const tabItems: TabsProps["items"] = [
        {
            key: "borrow",
            label: (
                <span className="text-base font-semibold text-gray-700 transition-colors">
                    Borrow
                </span>
            ),
        },
        {
            key: "repay",
            label: (
                <span className="text-base font-semibold text-gray-700 transition-colors">
                    Repay
                </span>
            ),
        },
    ];
    return (
        <div className="w-full">
            <Card className="w-full rounded-2xl shadow-lg">
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
                    {activeTab2 === "borrow" ? (
                        <RenderBorrow dashboardRef={dashboardRef} />
                    ) : (
                        <RenderRepay dashboardRef={dashboardRef} />
                    )}
                </motion.div>
            </Card>
        </div>
    );
};