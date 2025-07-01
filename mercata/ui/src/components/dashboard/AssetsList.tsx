import React, { useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button } from "../ui/button";
import DepositModal from "./DepositModal";
import DepositOptionsModal from "./DepositOptionsModal";
import { Token } from "../../interface";
import { formatUnits } from "ethers";

interface AssetsProps {
  loading: boolean;
  tokens: Token[];
}

const AssetsList = ({ loading, tokens }: AssetsProps) => {
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);

  const handleOptionSelect = (option: "credit-card" | "bridge") => {
    setIsOptionsModalOpen(false);
    if (option === "credit-card") {
      setIsDepositModalOpen(true);
    }
  };

  const getTokenName = (token: Token) => {
    return token["BlockApps-Mercata-ERC20"]?._name || "";
  };

  const getTokenSymbol = (token: Token) => {
    return token["BlockApps-Mercata-ERC20"]?._symbol || "";
  };

  const getTokenValue = (token: Token) => {
    return token.value || "-";
  };

  const getTokenTotalSupply = (token: Token) => {
    return token["BlockApps-Mercata-ERC20"]?._totalSupply || "-";
  };

  // Ensure tokens is an array and has items
  const validTokens = Array.isArray(tokens) ? tokens : [];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
      <div className="p-5 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">My Deposits</h2>
          <Button
            size="sm"
            className="bg-strato-blue hover:bg-strato-blue/90 text-white rounded-md flex items-center gap-1"
            onClick={() => setIsOptionsModalOpen(true)}
          >
            <Plus size={16} />
            Add Deposits
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                Asset
              </th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                Price
              </th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                Change
              </th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                Holdings
              </th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ?
              <tr className="hover:bg-gray-50 transition-colors">
                <td colSpan={5} className="py-4 px-4 whitespace-nowrap w-full">
                  <div className="w-full flex justify-center items-center h-16">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                  </div>
                </td>
              </tr>
              : tokens.length > 0 ? (
                tokens.slice(0, 5).map((asset, index) => (
                  <tr key={index} className="hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="ml-3">
                          <p className="font-medium text-gray-900">
                            {asset?.token?._name || ""}
                          </p>
                          <p className="text-gray-500 text-xs">
                            {asset?.token?._symbol || ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap text-right">
                      <p className="font-medium text-gray-900">
                        {!asset?.["price"] ? "-" : 
                          `$${parseFloat(formatUnits(BigInt(asset.price), 18)).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        }
                      </p>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap text-right">
                      <div
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${asset?.["change"] >= 0
                          ? "bg-green-50 text-green-600"
                          : "bg-red-50 text-red-600"
                          }`}
                      >
                        {asset?.["change"] !== undefined
                          ? `${asset?.["change"] >= 0 ? "+" : ""}${asset?.["change"]
                          }%`
                          : "-"}
                      </div>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap text-right">
                      <p className="font-medium text-gray-900">
                        {!asset?.balance ? "-" :
                          parseFloat(formatUnits(BigInt(asset.balance), 18)).toLocaleString(undefined, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 4,
                          })
                        }
                      </p>
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap text-right">
                      <p className="font-medium text-gray-900">
                        {!asset?.["price"] || !asset?.balance ? "-" :
                          `$${(parseFloat(formatUnits(BigInt(asset.price), 18)) * 
                           parseFloat(formatUnits(BigInt(asset.balance), 18))
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        }
                      </p>
                    </td>
                  </tr>
                ))) :
                (
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td colSpan={5} className="py-4 px-4 whitespace-nowrap w-full">
                      <div className="w-full flex justify-center items-center h-16">
                        <div>No data to show</div>
                      </div>
                    </td>
                  </tr>
                )
            }
          </tbody>
        </table>
      </div>

      <div className="p-4 text-right border-t border-gray-100">
        <a
          href="/dashboard/deposits"
          className="text-sm text-blue-500 hover:text-blue-600 flex items-center justify-end"
        >
          View All <ArrowUpRight size={14} className="ml-1" />
        </a>
      </div>

      <DepositOptionsModal
        isOpen={isOptionsModalOpen}
        onClose={() => setIsOptionsModalOpen(false)}
        onSelectOption={handleOptionSelect}
      />
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
      />
    </div>
  );
};

export default AssetsList;
