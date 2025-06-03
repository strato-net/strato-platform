"use client";

import React, { useState } from "react";
import {
  Card,
  InputNumber,
  Select,
  Button,
  Tabs,
  Radio,
  Table,
  message,
} from "antd";
import { motion } from "framer-motion";
const { Option } = Select;
const { TabPane } = Tabs;
/*─────────────────────────────────────────────────────────────────────────────
  Types & Constants
─────────────────────────────────────────────────────────────────────────────*/
interface HoldingRow {
  key: string;
  asset: string;
  balance: number;
}
const tokenOptions = [
  { symbol: "STR", name: "STRATO" },
  { symbol: "ETH", name: "Ether" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "DAI", name: "Dai" },
];
/*─────────────────────────────────────────────────────────────────────────────
  HoldingsDashboard
─────────────────────────────────────────────────────────────────────────────*/
const HoldingsDashboard: React.FC = () => {
  const [holdings] = useState<HoldingRow[]>([
    { key: "STR", asset: "STR", balance: 1_200 },
    { key: "ETH", asset: "ETH", balance: 3.5 },
    { key: "USDC", asset: "USDC", balance: 2_500 },
    { key: "DAI", asset: "DAI", balance: 1_000 },
  ]);
  const columns = [
    { title: "Asset", dataIndex: "asset", key: "asset" },
    {
      title: "Balance",
      dataIndex: "balance",
      key: "balance",
      render: (bal: number) => (
        <span className="font-mono">{bal.toLocaleString()}</span>
      ),
    },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card title="Your Holdings" className="w-full rounded-2xl shadow-lg">
        <Table
          dataSource={holdings}
          columns={columns}
          pagination={false}
          rowKey="key"
        />
      </Card>
    </motion.div>
  );
};

type liquidityTabKey = "deposit" | "borrow";
type TabKey = "swap" | "liquidity"

/*─────────────────────────────────────────────────────────────────────────────
  SwapPanel – Uniswap‑style swaps + liquidity
─────────────────────────────────────────────────────────────────────────────*/
const SwapPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("swap");
  /* Swap state */
  const [fromToken, setFromToken] = useState("STR");
  const [toToken, setToToken] = useState("ETH");
  const [fromAmount, setFromAmount] = useState<number>(0);
  /* Liquidity state */
  const [liquidityMode, setLiquidityMode] = useState<"add" | "remove">("add");
  const [tokenA, setTokenA] = useState("STR");
  const [tokenB, setTokenB] = useState("USDC");
  const [amountA, setAmountA] = useState<number>(0);
  const [amountB, setAmountB] = useState<number>(0);
  const [withdrawPercent, setWithdrawPercent] = useState<number>(0);
  const onSwap = () => {
    if (fromAmount <= 0) return message.error("Enter an amount > 0");
    message.success(`Swapped ${fromAmount} ${fromToken} → ${toToken} (mock)`);
  };
  const onAddLiquidity = () => {
    if (amountA <= 0 || amountB <= 0) return message.error("Enter amounts > 0");
    message.success(`Deposited ${amountA} ${tokenA} + ${amountB} ${tokenB} (mock)`);
  };
  const onRemoveLiquidity = () => {
    if (withdrawPercent <= 0 || withdrawPercent > 100)
      return message.error("Enter a % between 1‑100");
    message.success(`Withdraw ${withdrawPercent}% of position (mock)`);
  };
  const renderSwap = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">From</label>
        <div className="flex gap-2">
          <Select className="flex-1" value={fromToken} onChange={setFromToken}>
            {tokenOptions.map((t) => (
              <Option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </Option>
            ))}
          </Select>
          <InputNumber
            className="flex-1 w-full"
            min={0}
            value={fromAmount}
            onChange={(v) => setFromAmount(v ?? 0)}
            placeholder="Amount"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">To</label>
        <Select className="w-full" value={toToken} onChange={setToToken}>
          {tokenOptions
            .filter((t) => t.symbol !== fromToken)
            .map((t) => (
              <Option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </Option>
            ))}
        </Select>
      </div>
      <Button type="primary" className="w-full rounded-xl" onClick={onSwap}>
        Swap
      </Button>
    </div>
  );
  const renderLiquidity = () => (
    <div className="space-y-4">
      <Radio.Group
        value={liquidityMode}
        onChange={(e) => setLiquidityMode(e.target.value)}
        className="w-full flex justify-center mb-2"
      >
        <Radio.Button value="add">Deposit</Radio.Button>
        <Radio.Button value="remove">Withdraw</Radio.Button>
      </Radio.Group>
      {liquidityMode === "add" ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Token A</label>
              <Select className="w-full" value={tokenA} onChange={setTokenA}>
                {tokenOptions
                  .filter((t) => t.symbol !== tokenB)
                  .map((t) => (
                    <Option key={t.symbol} value={t.symbol}>
                      {t.symbol}
                    </Option>
                  ))}
              </Select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Token B</label>
              <Select className="w-full" value={tokenB} onChange={setTokenB}>
                {tokenOptions
                  .filter((t) => t.symbol !== tokenA)
                  .map((t) => (
                    <Option key={t.symbol} value={t.symbol}>
                      {t.symbol}
                    </Option>
                  ))}
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <InputNumber
              className="flex-1"
              min={0}
              value={amountA}
              onChange={(v) => setAmountA(v ?? 0)}
              placeholder="Amt A"
            />
            <InputNumber
              className="flex-1"
              min={0}
              value={amountB}
              onChange={(v) => setAmountB(v ?? 0)}
              placeholder="Amt B"
            />
          </div>
          <Button type="primary" className="w-full" onClick={onAddLiquidity}>
            Deposit Liquidity
          </Button>
        </>
      ) : (
        <>
          <label className="block text-sm font-medium mb-1">
            Withdraw (% of position)
          </label>
          <InputNumber
            className="w-full"
            min={0}
            max={100}
            value={withdrawPercent}
            onChange={(v) => setWithdrawPercent(v ?? 0)}
            placeholder="0‑100"
          />
          <Button danger type="primary" className="w-full" onClick={onRemoveLiquidity}>
            Withdraw Liquidity
          </Button>
        </>
      )}
    </div>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card title="Swap & Liquidity" className="w-full max-w-md mx-auto rounded-2xl shadow-lg">
        <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as TabKey)} centered>
          <TabPane tab="Swap" key="swap" />
          <TabPane tab="Liquidity" key="liquidity" />
        </Tabs>
        <div className="mt-4">
          {activeTab === "swap" ? renderSwap() : renderLiquidity()}
        </div>
      </Card>
    </motion.div>
  );
};
/*─────────────────────────────────────────────────────────────────────────────
  LendingPanel – Aave‑style deposit / borrow
─────────────────────────────────────────────────────────────────────────────*/
const LendingPanel: React.FC = () => {
  const [tab, setTab] = useState<liquidityTabKey>("deposit");
  const [asset, setAsset] = useState("USDC");
  const [amount, setAmount] = useState<number>(0);
  const onAction = () => {
    if (amount <= 0) return message.error("Enter an amount > 0");
    message.success(`${tab === "deposit" ? "Deposited" : "Borrowed"} ${amount} ${asset} (mock)`);
  };
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card title="Lend / Borrow" className="w-full max-w-md mx-auto rounded-2xl shadow-lg">
        <Tabs activeKey={tab} onChange={(k) => setTab(k as liquidityTabKey)} centered>
          <TabPane tab="Deposit" key="deposit" />
          <TabPane tab="Borrow" key="borrow" />
        </Tabs>
        <div className="space-y-4 mt-4">
          <InputNumber
            className="w-full"
            min={0}
            value={amount}
            onChange={(v) => setAmount(v ?? 0)}
            placeholder="Amount"
          />
          <Select className="w-full" value={asset} onChange={setAsset}>
            {tokenOptions.map((t) => (
              <Option key={t.symbol} value={t.symbol}>
                {t.symbol}
              </Option>
            ))}
          </Select>
          <Button type="primary" className="w-full" onClick={onAction}>
            {tab === "deposit" ? "Deposit" : "Borrow"}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
};
/*─────────────────────────────────────────────────────────────────────────────
  HomePage – dashboard + panels
─────────────────────────────────────────────────────────────────────────────*/
const HomePage: React.FC = () => (
  <main className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 space-y-8">
    <h1 className="text-3xl font-bold text-center">STRATO DeFi Mock App</h1>
    <div className="w-full max-w-5xl">
      <HoldingsDashboard />
    </div>
    <section className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
      <SwapPanel />
      <LendingPanel />
    </section>
  </main>
);
export default HomePage;