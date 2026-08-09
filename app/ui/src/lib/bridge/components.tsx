import { CopyOutlined } from "@ant-design/icons";

/**
 * Renders a truncated address with copy functionality
 */
export function renderTruncatedAddressWithCopy(address: string, onCopy?: (text: string) => void) {
  if (!address) return "-";
  
  const truncatedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  
  return (
    <div className="group relative flex items-center gap-2">
      <span className="cursor-pointer">
        {truncatedAddress}
      </span>
      <CopyOutlined
        className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
        onClick={() => onCopy?.(address)}
      />
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
        {address}
      </div>
    </div>
  );
}
