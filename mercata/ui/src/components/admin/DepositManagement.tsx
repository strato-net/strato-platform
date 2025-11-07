import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, XCircle } from 'lucide-react';
import { formatBalance } from '@/utils/numberUtils';
import { getChainName, BRIDGE_STATUS_MAP } from '@/lib/bridge/utils';
import { Table } from 'antd';
import { useBridgeAdminContext } from '@/context/BridgeAdminContext';
import { ITEMS_PER_PAGE, getIndexRenderer, renderAddressWithCopy, renderHashWithCopy } from './utils';

const DepositManagement = () => {
  const { deposits, depositsTotalCount, loadingDeposits, fetchDeposits, abortDeposit } = useBridgeAdminContext();
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const { toast } = useToast();

  useEffect(() => {
    fetchDeposits(currentPage, ITEMS_PER_PAGE);
    const interval = setInterval(() => fetchDeposits(currentPage, ITEMS_PER_PAGE), 30000);
    return () => clearInterval(interval);
  }, [currentPage, fetchDeposits]);

  const handleAbort = async (chainId: string, txHash: string) => {
    const key = `${chainId}-${txHash}`;
    try {
      setProcessing(prev => ({ ...prev, [key]: true }));
      await abortDeposit(chainId, txHash);
      toast({ title: 'Success', description: 'Deposit aborted successfully' });
      await fetchDeposits(currentPage, ITEMS_PER_PAGE);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to abort deposit', variant: 'destructive' });
    } finally {
      setProcessing(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
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
      title: 'Actions',
      key: 'actions',
      width: 100,
      align: 'right' as const,
      render: (_: any, record: any) => {
        if (getInfo(record).bridgeStatus !== '2') return null;
        const key = `${record.externalChainId}-${record.externalTxHash}`;
        return (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleAbort(record.externalChainId, record.externalTxHash)}
            disabled={processing[key]}
            title="Abort"
          >
            {processing[key] ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
          </Button>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Deposit Management</CardTitle>
        <Button variant="outline" size="sm" onClick={() => fetchDeposits(currentPage, ITEMS_PER_PAGE)} disabled={loadingDeposits}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loadingDeposits ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
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
