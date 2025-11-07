import { CopyOutlined } from '@ant-design/icons';
import { ExternalLink } from 'lucide-react';
import { ensureHexPrefix } from '@/utils/numberUtils';
import { getChainName } from '@/lib/bridge/utils';

export const ITEMS_PER_PAGE = 10;

const COPY_BUTTON_CLASS = "text-gray-400 hover:text-blue-600 cursor-pointer";
const LINK_CLASS = "text-sm text-blue-600 hover:underline font-mono";

const handleCopy = async (text: string, toast: any, message: string, e: React.MouseEvent) => {
  e.stopPropagation();
  await navigator.clipboard.writeText(text);
  toast({ title: 'Copied!', description: message });
};

const CopyButton = ({ text, toast, message }: { text: string; toast: any; message: string }) => (
  <CopyOutlined className={COPY_BUTTON_CLASS} onClick={(e) => handleCopy(text, toast, message, e)} />
);

const LinkIcon = () => <ExternalLink className="h-3 w-3" />;

export const renderAddressWithCopy = (address: string, toast: any, startLen = 8) => {
  if (!address) return '-';
  const addr = ensureHexPrefix(address);
  return (
    <div className="flex items-center gap-1 text-sm font-mono">
      <span>{addr.slice(0, startLen)}...</span>
      <CopyButton text={addr} toast={toast} message="Address copied to clipboard" />
    </div>
  );
};

export const renderHashWithCopy = (hash: string, toast: any, startLen = 16, link?: string) => {
  if (!hash) return '-';
  return (
    <div className="flex items-center gap-1 text-sm font-mono">
      <span>{hash.slice(0, startLen)}...</span>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          <LinkIcon />
        </a>
      )}
      <CopyButton text={hash} toast={toast} message="Hash copied to clipboard" />
    </div>
  );
};

export const renderSafeTxHash = (hash: string, chainId: string | number, toast: any) => {
  if (!hash) return <span className="text-xs text-gray-400">No Safe TX</span>;
  const safeUrl = `https://app.safe.global/transactions/tx?safe=${getChainName(chainId).toLowerCase()}:${hash}`;
  return (
    <div className="flex items-center gap-1">
      <a href={safeUrl} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS} flex items-center gap-1`}>
        {hash.slice(0, 8)}...
        <LinkIcon />
      </a>
      <CopyButton text={hash} toast={toast} message="Safe TX hash copied to clipboard" />
    </div>
  );
};

export const getIndexRenderer = (currentPage: number) => (_: any, __: any, index: number) => {
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  return <span className="font-bold">{startIndex + index + 1}</span>;
};
