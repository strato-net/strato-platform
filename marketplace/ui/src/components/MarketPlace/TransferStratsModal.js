import React, { useState } from 'react';
import { Button, Card, InputNumber, Modal, Select } from 'antd';
import {
  useMarketplaceDispatch,
  useMarketplaceState
} from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";

const TransferStratsModal = ({ visible, onCancel }) => {
  
  //Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const { isTransferringStrats } = useMarketplaceState();
  
  const [receiverAddress, setReceiverAddress] = useState('');
  const [amount, setAmount] = useState(0);
  
  const handleChange = (value) => {
    setAmount(value);
  }

  const userDispatch = useUsersDispatch();
  const {
      user
  } = useAuthenticateState();
  const {
      users
  } = useUsersState();
  const usersList = (users || []).map((record) => ((user || {}).commonName !== record.commonName ? { label: `${record.commonName} - ${record.organization}`, value: record.userAddress } : {}));
  const filterDuplicateUserAddresses = (arr) => {
      return [...new Map(arr.map((u) => [u.value, u])).values()];
  };
  const filteredUsersList = filterDuplicateUserAddresses(usersList);

  let timeout
  const onSearch = (e) => {
    if (e && e !== '') {
      clearTimeout(timeout)
      timeout = setTimeout(() => userActions.fetchUsers(userDispatch, e), 500)
    }
  }

  const handleSelect = (e) => {
    setReceiverAddress(e);
  }
  
  const handleSubmit = async (e) => {
    const payload = {
      to: receiverAddress,
      value: amount !== undefined ? amount * 100 : 0
    }
    await actions.transferStrats(marketplaceDispatch, payload);
    actions.fetchStratsBalance(marketplaceDispatch);
    handleCancel(e);
  };

  const handleCancel = (e) => {
    onCancel(e);
  }

  return (
      <Modal
          title="Transfer STRATs"
          open={visible}
          onCancel={handleCancel}
          footer={[
              <Button key="back" onClick={handleCancel}>
                  Cancel
              </Button>,
              <Button key="submit" type="primary" onClick={handleSubmit} disabled={isTransferringStrats}>
                Submit
              </Button>,
          ]}
      >
        <Card style={{ height: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column', justifyContent: 'center' }}>
            <div>
              <p className="text-[#202020] font-medium text-sm">Recipient</p>
              <Select
                style={{ width: '20rem', marginBottom: '10px' }}
                placeholder={'Select Recipient'}
                showSearch
                size="large"
                onSearch={onSearch}
                onSelect={handleSelect}
                options={filteredUsersList}
                optionFilterProp="value"
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>
            <div>
              <p className="text-[#202020] font-medium text-sm">Amount</p>
              <InputNumber
                style={{ width: '20rem', marginBottom: '10px' }}
                controls={false}
                size={"large"}
                min={0.00}
                precision={2}
                defaultValue={amount}
                onChange={(e) => handleChange(e)}
                value={amount}
              />
            </div>
          </div>
        </Card>
      </Modal>
  );
};

export default TransferStratsModal;
