import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';
import { formatBalance } from '@/utils/numberUtils';
import { getChainName, BRIDGE_STATUS_MAP, DEPOSIT_STATUS_OPTIONS } from '@/lib/bridge/utils';
import { Table } from 'antd';
import { useBridgeAdminContext } from '@/context/BridgeAdminContext';
import { ITEMS_PER_PAGE, getIndexRenderer, renderAddressWithCopy, renderHashWithCopy, formatTimestampToNY } from './utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DepositManagement = () => {
  const { deposits, depositsTotalCount, loadingDeposits, fetchDeposits } = useBridgeAdminContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<number | null>(2); // Default to Pending Review
  const { toast } = useToast();

  useEffect(() => {
    fetchDeposits(currentPage, ITEMS_PER_PAGE, statusFilter);
    const interval = setInterval(() => fetchDeposits(currentPage, ITEMS_PER_PAGE, statusFilter), 30000);
    return () => clearInterval(interval);
  }, [currentPage, statusFilter, fetchDeposits]);

  const handleStatusFilterChange = (value: string) => {
    const status = value === 'all' ? null : parseInt(value);
    setStatusFilter(status);
    setCurrentPage(1); // Reset to first page when filter changes
  };

  const getInfo = (record: any) => record.DepositInfo || {};

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 60,
      render: getIndexRenderer(currentPage),
    },
    {
      title: 'STRATO Token',
      key: 'stratoToken',
      width: 150,
      render: (_: any, record: any) => {
        const token = getInfo(record).stratoToken;
        return token ? renderAddressWithCopy(token, toast, 8) : '-';
      },
    },
    {
      title: 'TX Hash',
      key: 'txHash',
      dataIndex: 'externalTxHash',
      width: 200,
      render: (txHash: string) => renderHashWithCopy(txHash, toast, 16),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_: any, record: any) => {
        const status = BRIDGE_STATUS_MAP[getInfo(record).bridgeStatus] || BRIDGE_STATUS_MAP['0'];
        return <Badge className={`${status.color} text-white text-xs`}>{status.label}</Badge>;
      },
    },
    {
      title: 'Chain',
      key: 'chain',
      width: 120,
      render: (_: any, record: any) => getChainName(record.externalChainId),
    },
    {
      title: 'From',
      key: 'from',
      width: 150,
      render: (_: any, record: any) => renderAddressWithCopy(getInfo(record).externalSender, toast),
    },
    {
      title: 'To',
      key: 'to',
      width: 150,
      render: (_: any, record: any) => renderAddressWithCopy(getInfo(record).stratoRecipient, toast),
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      render: (_: any, record: any) => (
        <span className="font-semibold">{formatBalance(getInfo(record).stratoTokenAmount || '0', undefined, 18)}</span>
      ),
    },
    {
      title: 'Timestamp',
      key: 'timestamp',
      width: 180,
      render: (_: any, record: any) => (
        <span className="text-sm">{formatTimestampToNY(record.block_timestamp)}</span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Deposit Management</CardTitle>
        <div className="flex items-center gap-3">
          <Select value={statusFilter === null ? 'all' : statusFilter.toString()} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {DEPOSIT_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value === null ? 'all' : option.value.toString()} value={option.value === null ? 'all' : option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => fetchDeposits(currentPage, ITEMS_PER_PAGE, statusFilter)} disabled={loadingDeposits}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loadingDeposits ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table
          columns={columns}
          dataSource={deposits}
          loading={loadingDeposits}
          rowKey={(record) => `${record.externalChainId}-${record.externalTxHash}`}
          pagination={{
            current: currentPage,
            total: depositsTotalCount,
            pageSize: ITEMS_PER_PAGE,
            onChange: setCurrentPage,
            showSizeChanger: false,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} deposits`,
          }}
        />
      </CardContent>
    </Card>
  );
};

export default DepositManagement;
