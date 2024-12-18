import React, { useEffect } from 'react';
import { Modal, Spin } from 'antd';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { actions } from '../../contexts/marketplace/actions';
import { actions as userActions } from '../../contexts/users/actions';
import { useUsersDispatch, useUsersState } from '../../contexts/users';
import DataTableComponent from '../DataTableComponent';
import moment from 'moment';

const UsdstTransactionHistoryModal = ({ visible, onCancel }) => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const userDispatch = useUsersDispatch();
  const { isFetchingUsdstTransactionHistory, usdstTransactionHistory } =
    useMarketplaceState();
  const { users } = useUsersState();

  useEffect(() => {
    actions.fetchUsdstTransactionHistory(marketplaceDispatch);
  }, [marketplaceDispatch]);

  useEffect(() => {
    userActions.fetchUsers(userDispatch);
  }, []);

  const data = usdstTransactionHistory
    .map((r) => {
      const displayName = (addr) => {
        const user = users.find((u) => u.userAddress == addr);
        if (user) {
          return `${user.commonName}`;
        } else {
          if (addr == '0000000000000000000000000000000000000000') {
            return 'RESERVE';
          } else {
            return addr;
          }
        }
      };

      return {
        key: r.id,
        ...r,
        value: (parseInt(r._value) / 100).toLocaleString(),
        to: displayName(r._to),
        from: displayName(r._from),
        timestamp: moment.unix(r.timestamp).format('MM-DD-YYYY hh:mm a'),
      };
    })
    .reverse();

  const columns = [
    {
      title: 'Date',
      dataIndex: 'timestamp',
      align: 'center',
    },
    {
      title: 'Sender',
      dataIndex: 'from',
      align: 'center',
    },
    {
      title: 'Recipient',
      dataIndex: 'to',
      align: 'center',
    },
    {
      title: 'Value',
      dataIndex: 'value',
      align: 'center',
    },
  ];

  return (
    <Modal
      title="USDST Transaction History"
      open={visible}
      centered
      onCancel={onCancel}
      footer={false}
      width={900}
    >
      <Spin spinning={isFetchingUsdstTransactionHistory} size="large">
        <DataTableComponent
          columns={columns}
          data={data}
          isLoading={isFetchingUsdstTransactionHistory}
          pagination={false}
          scrollX="100%"
        />
      </Spin>
    </Modal>
  );
};

export default UsdstTransactionHistoryModal;
