import { notification, Select, Spin } from "antd";
import TokenDropdown from "../_dropdown/page";
import { ethers } from "ethers";
import { ChildComponentProps, EnrichedLoan, LoanEntry, TokenData } from "@/interface/token";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useTokens } from "@/context/TokenContext";

export const RenderRepay = ({ dashboardRef }: ChildComponentProps) => {
    const [loanList, setLoanList] = useState<EnrichedLoan[]>([]);
    const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
    const [loan, setLoan] = useState<LoanEntry | null>(null);
    const [amount, setAmount] = useState<string>("");
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");
    const [repayLoading, setRepayLoading] = useState(false);
    const [api, contextHolder] = notification.useNotification();
    const { tokens } = useTokens();


    // Load user address and fetch their loans with token metadata
    const fetchLoans = useCallback(async () => {
        const userData = JSON.parse(localStorage.getItem("user") || "{}");
        const addr = userData.userAddress;
        try {
            const resp = await axios.get("/api/loans");
            const pool = resp.data;
            const loansObj = pool.loans || {};
            const userLoans = Object.entries(loansObj)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map(([loanId, loan]: [string, any]) => ({ loanId, ...loan }))
                .filter((loan: LoanEntry) => loan.user === addr && loan.active === true);
            // Enrich each loan with token symbol, name, and human-readable balance
            const enrichedLoans = await Promise.all(
                userLoans.map(async (loan: LoanEntry) => {
                    const balanceHuman = ethers.formatUnits(
                        BigInt(loan?.amount || 0) + BigInt(loan?.interest || 0),
                        18
                    );
                    return {
                        ...loan,
                        _name: loan.assetName,
                        _symbol: loan?.assetSymbol || "",
                        balanceHuman,
                    };
                })
            );
            setLoanList(enrichedLoans);
            if (enrichedLoans.length > 0) {
                setLoan(enrichedLoans[0]);
                setAmount(enrichedLoans[0].balanceHuman);
            }
        } catch (e) {
            console.error("Error fetching loans:", e);
        }
    }, []);

    useEffect(() => {
        fetchLoans();
    }, [fetchLoans]);

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (/^\d*\.?\d*$/.test(value)) {
            setAmount(value);
        }
    };

    const repayLoan = async () => {
        try {
            setRepayLoading(true);
            const amountInWei = ethers.parseUnits(amount, 18).toString();
            const response = await axios.post("api/lend/repay", {
                loanId: loan?.loanId,
                amount: amountInWei,
                asset: loan?.asset,
            });
            console.log(response, "repay loan response");
            await fetchLoans();
            setRepayLoading(false);
            api["success"]({
                message: "Success",
                description: `Successfully Repaid ${amount} ${loan?._symbol}`,
            });
            dashboardRef.current?.refresh();
            setLoan(null)
        } catch (error) {
            api["error"]({
                message: "Error",
                description: `Repay Error - ${error}`,
            });
            setRepayLoading(false);
            console.error("Error repaying loan:", error);
        } finally {
            setAmount("");
            setRepayLoading(false);
        }
    };

    const handleRepay = () => {
        if (isFormValid) {
            repayLoan();
        }
    };

    const isFormValid =
        !!loan?.loanId && !!selectedToken && parseFloat(amount) > 0;

    useEffect(() => {
        if (tokens && tokens.length > 0) {
            setSelectedToken(tokens[0]);
        }
    }, [tokens]);

    const handleTokenSelect = (token: TokenData) => {
        setSelectedToken(token);
        setShowTokenSelector(false);
    };

    return (
        <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
            <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
                <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
                    Repay Loan
                </h2>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-blue-700 mb-1">
                        Select Loan
                    </label>
                    <Select
                        value={loan?.loanId}
                        onChange={(value: string) => {
                            const selected = loanList.find((l) => l.loanId === value);
                            setLoan(selected || null);
                            setAmount(selected?.balanceHuman || "");
                        }}
                        options={loanList.map((loan) => ({
                            label: `${loan._symbol} - ${loan.balanceHuman}`,
                            value: loan.loanId,
                        }))}
                        placeholder="Select a loan"
                        className="w-full"
                    />
                    {loan && (
                        <div className="mt-2 p-4 bg-blue-50 rounded-lg">
                            <p className="text-sm text-blue-800 mb-1">
                                <span className="font-medium">Principal:</span> {ethers.formatUnits(loan?.amount || 0, 18)} {loan._symbol}
                            </p>
                            <p className="text-sm text-blue-800 mb-1">
                                <span className="font-medium">Interest:</span> {ethers.formatUnits(loan?.interest || 0, 18)} {loan._symbol}
                            </p>
                            <p className="text-sm font-medium text-blue-900">
                                Total outstanding: {loan.balanceHuman} {loan._symbol}
                            </p>
                        </div>
                    )}
                </div>
                <div className="mb-6">
                    <label className="block text-sm font-medium text-blue-700 mb-1">
                        Amount
                    </label>
                    <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
                        <input
                            value={amount}
                            onChange={handleAmountChange}
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*\.?[0-9]*"
                            placeholder="0.00"
                            className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
                        />
                        {loan &&
                            <div className="flex items-center gap-2 ml-3">
                                <h3 className="text-base font-semibold text-gray-700">
                                    {loan?._symbol ?? "ETH"}
                                </h3>
                            </div>}
                    </div>
                </div>

                <div className="mt-10 w-1/2 mx-auto">
                    <button
                        onClick={handleRepay}
                        disabled={!isFormValid || repayLoading}
                        className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl transition ${isFormValid && !repayLoading
                            ? "cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white"
                            : "cursor-not-allowed bg-gray-300"
                            }`}
                    >
                        {repayLoading && <Spin />}
                        {repayLoading ? "Repaying..." : "Repay"}
                    </button>
                </div>
            </div>

            {showTokenSelector && (
                <TokenDropdown
                    show={showTokenSelector}
                    onClose={() => setShowTokenSelector(false)}
                    tokenSearchQuery={tokenSearchQuery}
                    setTokenSearchQuery={setTokenSearchQuery}
                    popularTokens={tokens}
                    handleTokenSelect={handleTokenSelect}
                />
            )}
            {contextHolder}
        </div>
    );
};