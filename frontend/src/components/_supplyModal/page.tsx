import Image from "next/image";

interface SupplyModalProps {
    onClose: () => void;
  }
  
  export default function SupplyModal ({ onClose }: SupplyModalProps) {
    return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="relative p-2 max-w-md mx-auto">
        <div className="text-right absolute top-[2rem] right-[2.2rem]">
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg
              className="w-5 h-5 inline"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="bg-white rounded-md shadow p-6 max-w-md mx-auto">
          <h2 className="text-2xl font-semibold mb-4">Withdraw USDT</h2>
  
          <div
            className="flex items-start bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"
            role="alert"
          >
            <div className="flex-1">
              <p>
                Please switch to Ethereum Sepolia.
                <button type="button" className="text-blue-600 underline ml-2">
                  Switch Network
                </button>
              </p>
            </div>
          </div>
  
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amount
            </label>
            <div className="flex items-center border border-gray-300 rounded px-3 py-2">
              <input
                type="text"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none"
              />
              <div className="flex items-center gap-1 ml-3">
                <Image
                  src="/icons/tokens/usdt.svg"
                  alt="USDT icon"
                  className="w-6 h-6"
                />
                <h3 className="text-base font-semibold">USDT</h3>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 text-sm text-gray-500">
              <span>$0</span>
              <div className="flex items-center gap-2">
                <span>Supply balance</span>
                <span className="font-medium text-gray-800">10.56K</span>
                <button type="button" className="text-blue-600 underline text-sm">
                  Max
                </button>
              </div>
            </div>
          </div>
  
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Transaction overview
            </p>
            <div className="flex">
              <div className="px-3 py-2 border border-[#eaebef] rounded-[6px] flex justify-between text-sm mb-2">
                <span>Supply APY</span>
                <span className="text-gray-800">
                  10,560.30 <span className="text-gray-500">USDT</span>
                </span>
              </div>
              <div className="px-3 py-2 border border-[#eaebef] rounded-[6px] flex justify-between text-sm mb-2">
                <span>Supply APY</span>
                <span className="text-gray-800">
                  10,560.30 <span className="text-gray-500">USDT</span>
                </span>
              </div>
            </div>
  
            <div className="mb-6 mt-6 flex items-center text-sm text-gray-600">
              <svg
                className="w-5 h-5 text-blue-500 mr-2"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M19.77 7.23l-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77M12 10H6V5h6zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"
                  fill="currentColor"
                />
              </svg>
              <span>-</span>
            </div>
          </div>
  
          <div className="mb-4">
            <button
              type="button"
              className="w-full bg-gray-300 text-gray-600 font-semibold py-2 px-4 rounded cursor-not-allowed"
              disabled
            >
              Wrong Network
            </button>
          </div>
  
        </div>
      </div>
    </div>
  )};