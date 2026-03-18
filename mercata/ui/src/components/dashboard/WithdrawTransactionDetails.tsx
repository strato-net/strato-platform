import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Table, Select, Space, Card } from 'antd';
import { CopyOutlined, FrownOutlined } from '@ant-design/icons';
import { useBridgeContext } from '@/context/BridgeContext';
import { formatDate, getChainName, BRIDGE_STATUS_OPTIONS, CHAIN_OPTIONS, handleCopyToClipboard, getExplorerUrl } from '@/lib/bridge/utils';
import { renderTruncatedAddressWithCopy } from '@/lib/bridge/components';
import { ITEMS_PER_PAGE } from '@/lib/bridge/constants';
import { formatWeiToDecimalHP } from '@/utils/numberUtils';
import { ensureHexPrefix } from '@/utils/numberUtils';
import { usdstAddress } from '@/lib/constants';
import { useIsMobile } from '@/hooks/use-mobile';

const normalizeStratoAccount = (account?: string) => (account || '').replace(/^0x/i, '');

const WithdrawTransactionDetails = ({ context }: { context?: string }) => {
  const isMobile = useIsMobile();
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [withdrawalStatus, setWithdrawalStatus] = useState<number>(0);
  const [selectedChainId, setSelectedChainId] = useState<number>(0);
  const [selectedType, setSelectedType] = useState<'bridge' | 'convert' | ''>('');
  const [transactions, setTransactions] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const {
    fetchWithdrawTransactions,
    availableNetworks,
    withdrawalRefreshKey,
  } = useBridgeContext();

  useEffect(() => {
    const loadTransactions = async () => {
      setIsLoading(true);
      try {
        const params: Record<string, string> = {
          limit: ITEMS_PER_PAGE.toString(),
          offset: ((currentPage - 1) * ITEMS_PER_PAGE).toString(),
          order: 'block_timestamp.desc',
        };

        if (selectedType === 'convert') {
          (params as any)["value->>stratoToken"] = `eq.${usdstAddress}`;
        } else if (selectedType === 'bridge') {
          (params as any)["value->>stratoToken"] = `neq.${usdstAddress}`;
        }

        if (withdrawalStatus !== 0) {
          (params as any)["value->>bridgeStatus"] = `eq.${withdrawalStatus}`;
        }

        if (selectedChainId !== 0) {
          (params as any)["value->>externalChainId"] = `eq.${selectedChainId}`;
        }

        const result = await fetchWithdrawTransactions(params, context);
        setTransactions(result.data);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error('Error loading transactions:', error);
        setTransactions([]);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    loadTransactions();
  }, [currentPage, withdrawalStatus, selectedChainId, fetchWithdrawTransactions, context, selectedType, withdrawalRefreshKey]);

  const columns = [
    {
      title: 'From (STRATO)',
      key: 'from',
      render: (_: any, record: any) => {
        const rawAddr = record?.WithdrawalInfo?.stratoSender || '';
        const displayAddr = normalizeStratoAccount(rawAddr);
        const linkAddr = ensureHexPrefix(rawAddr) || '';
        const chainIdStr = record?.WithdrawalInfo?.externalChainId ? String(record.WithdrawalInfo.externalChainId) : '1';
        const txUrl = getExplorerUrl(chainIdStr, '0x');
        const base = txUrl.split('/tx/')[0];
        const addressUrl = linkAddr ? `${base}/address/${linkAddr}` : '';

        return displayAddr ? (
          <div className="group relative flex items-center gap-2">
            <a
              href={addressUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800"
            >
              {`${displayAddr.slice(0, 6)}...${displayAddr.slice(-4)}`}
            </a>
            <CopyOutlined
              className="text-muted-foreground hover:text-blue-500 cursor-pointer transition-colors"
              onClick={() => handleCopyToClipboard(displayAddr)}
            />
          </div>
        ) : '-';
      },
      width: 100,
    },
    {
      title: "To",
      key: 'to',
      render: (_: any, record: any) => {
        const chainName = record?.WithdrawalInfo?.externalChainId
          ? getChainName(parseInt(record.WithdrawalInfo.externalChainId))
          : 'Unknown Chain';
        const addr = ensureHexPrefix(record?.WithdrawalInfo?.externalRecipient) || '';
        const chainIdStr = record?.WithdrawalInfo?.externalChainId ? String(record.WithdrawalInfo.externalChainId) : '1';
        const txUrl = getExplorerUrl(chainIdStr, '0x');
        const base = txUrl.split('/tx/')[0];
        const addressUrl = `${base}/address/${addr}`;
        return (
          <div>
            <div className="text-xs text-muted-foreground mb-1">{chainName}</div>
            {addr ? (
              <div className="group relative flex items-center gap-2">
                <a
                  href={addressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
                  {`${addr.slice(0, 6)}...${addr.slice(-4)}`}
                </a>
                <CopyOutlined
                  className="text-muted-foreground hover:text-blue-500 cursor-pointer transition-colors"
                  onClick={() => handleCopyToClipboard(addr)}
                />
              </div>
            ) : '-'}
          </div>
        );
      },
      width: 120,
    },
    {
      title: "Sent",
      key: "sent",
      render: (_: any, record: any) => {
        const symbol = record?.stratoTokenSymbol || '-';
        const amount = formatWeiToDecimalHP(record?.WithdrawalInfo?.stratoTokenAmount || '0', 18);
        return <span className="text-sm text-foreground">{amount} {symbol}</span>;
      },
      width: 140,
    },
    {
      title: "Received",
      key: "received",
      render: (_: any, record: any) => {
        const symbol = record?.externalSymbol || (record?.externalName === 'Ether' ? 'ETH' : record?.externalName) || '-';
        const amount = formatWeiToDecimalHP(record?.WithdrawalInfo?.stratoTokenAmount || '0', 18);
        return <span className="text-sm text-foreground">{amount} {symbol}</span>;
      },
      width: 140,
    },
    {
      title: 'Status',
      key: 'withdrawalStatus',
      render: (_: any, record: any) => {
        const statusStr = record?.WithdrawalInfo?.bridgeStatus || '0';
        const statusNum = parseInt(statusStr);
        if (statusNum === 1) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              <Clock className="h-3 w-3 mr-1" />
              Initiated
            </span>
          );
        } else if (statusNum === 2) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Pending Review
            </span>
          );
        } else if (statusNum === 3) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Completed
            </span>
          );
        } else if (statusNum === 4) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Aborted
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
            <AlertCircle className="h-3 w-3 mr-1" />
            Unknown
          </span>
        );
      },
      width: 80,
    },
    {
      title: 'Time',
      dataIndex: 'block_timestamp',
      key: 'block_timestamp',
      render: (text: string) => formatDate(text),
      width: 200,
    },
  ];

  return (
    <div className="space-y-4 ant-table-themed">
      <Card className="bg-card rounded-xl shadow-sm border border-border">
        <Space 
          size="large" 
          direction={isMobile ? "vertical" : "horizontal"} 
          className={isMobile ? "w-full" : ""}
          style={isMobile ? { width: '100%' } : {}}
        >
          <div className={isMobile ? "w-full" : ""}>
            <label className="block text-sm font-medium text-foreground mb-1">
              Type
            </label>
            <Select
              value={selectedType || ''}
              onChange={(v) => {
                setSelectedType(v === '' ? '' : v as 'bridge' | 'convert');
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={[
                { value: '', label: 'All Types' },
                { value: 'bridge', label: 'Bridge' },
                { value: 'convert', label: 'Convert' },
              ]}
            />
          </div>
          <div className={isMobile ? "w-full" : ""}>
            <label className="block text-sm font-medium text-foreground mb-1">
              Status Filter
            </label>
            <Select
              value={withdrawalStatus || 0}
              onChange={(v) => {
                setWithdrawalStatus(v || 0);
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={BRIDGE_STATUS_OPTIONS}
            />
          </div>
          <div className={isMobile ? "w-full" : ""}>
            <label className="block text-sm font-medium text-foreground mb-1">
              Chain Filter
            </label>
            <Select
              value={selectedChainId || 0}
              onChange={(v) => {
                setSelectedChainId(v || 0);
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={[
                { value: 0, label: 'All Chains' },
                ...availableNetworks.map((n) => ({ value: parseInt(n.chainId), label: n.chainName }))
              ]}
            />
          </div>
        </Space>
      </Card>
      
      <div className="bg-card rounded-xl shadow-sm border border-border overflow-x-auto">
        <Table
          columns={columns}
          dataSource={transactions}
          loading={isLoading}
          scroll={isMobile ? { x: 'max-content' } : undefined}
          pagination={{
            current: currentPage,
            total: totalCount,
            pageSize: ITEMS_PER_PAGE,
            onChange: (page) => setCurrentPage(page),
            showSizeChanger: false,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
            simple: isMobile,
          }}
          locale={{
            emptyText: (
              <div className="py-12 text-center text-muted-foreground">
                <div className="flex flex-col items-center justify-center gap-2">
                  <FrownOutlined style={{ fontSize: 48, color: "currentColor" }} />
                  <span className="text-lg font-semibold text-muted-foreground">
                    Sorry, no data found
                  </span>
                </div>
              </div>
            ),
          }}
          rowKey={(_, index) => index}
        />
      </div>
    </div>
  );
};

export default WithdrawTransactionDetails;
