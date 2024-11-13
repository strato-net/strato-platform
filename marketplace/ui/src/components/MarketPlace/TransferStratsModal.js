import React, { useState, useEffect } from 'react';
import { Button, Card, InputNumber, Modal, Select, notification } from 'antd';
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";

const TransferStratsModal = ({ visible, onCancel }) => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const { isTransferringStrats, strats, message, success } = useMarketplaceState();
  const userDispatch = useUsersDispatch();
  const {
    user
  } = useAuthenticateState();
  const {
    users
  } = useUsersState();

  const [receiverAddress, setReceiverAddress] = useState('');
  const [amount, setAmount] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [canTransfer, setCanTransfer] = useState(true);
  const [api, contextHolder] = notification.useNotification();

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(marketplaceDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(marketplaceDispatch),
        placement,
        key: 2,
      });
    }
  };

  const usersList = (users || []).map((record) => ((user || {}).commonName !== record.commonName ? { label: `${record.commonName} - ${record.organization}`, value: record.userAddress } : {}));
  const filterDuplicateUserAddresses = (arr) => {
    return [...new Map(arr.map((u) => [u.value, u])).values()];
  };
  const filteredUsersList = filterDuplicateUserAddresses(usersList);

  useEffect(() => {
    userActions.fetchUsers(userDispatch);
  }, []);

  useEffect(() => {
    if (amount > strats || strats <= 0 || amount <= 0 || !strats || Object.keys(strats).length === 0 || !receiverAddress) {
      setCanTransfer(false);
    }
    else {
      setCanTransfer(true);
    };
  }, [strats, amount, receiverAddress])

  const onSearch = (value) => {
    setSearchInput(value);
    setDropdownOpen(!!value);
  }

  const handleChange = (value) => {
    setAmount(value);
  }

  const handleSelect = (e) => {
    setReceiverAddress(e);
    setDropdownOpen(false);
  }

  const handleSubmit = async (e) => {
    const payload = {
      to: receiverAddress,
      value: amount !== undefined ? (amount * 100).toFixed(0) : 0
    };

    if (amount > 0 && amount <= strats && receiverAddress) {
      let isDone = await actions.transferStrats(marketplaceDispatch, payload);
      if (isDone) {
        handleCancel();
        await actions.fetchStratsBalance(marketplaceDispatch);
      }
    }
  };

  const handleCancel = () => {
    onCancel();
    setAmount(0);
    setReceiverAddress('');
    setSearchInput('');
  };

  const filteredOptions = searchInput
    ? filteredUsersList.filter(option =>
      option.label && option.label.toLowerCase().includes(searchInput.toLowerCase())
    )
    : [];

  return (
    <Modal
      title="Transfer STRATs"
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="submit" type="primary" onClick={handleSubmit} loading={isTransferringStrats} disabled={!canTransfer}>
          Submit
        </Button>,
      ]}
    >
      {contextHolder}
      <Card className='h-[200px]'>
        <div className='flex items-center flex-col justify-center'>
          <div>
            <p className="text-[#202020] font-medium text-sm">Recipient</p>
            <Select
              className='w-[20rem] mb-[10px]'
              placeholder={'Select Recipient'}
              showSearch
              size="large"
              onSearch={onSearch}
              onSelect={handleSelect}
              options={filteredOptions}
              optionFilterProp="value"
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              open={dropdownOpen}
              onFocus={() => setDropdownOpen(!!searchInput)}
              onBlur={() => setDropdownOpen(false)}
              popupClassName="custom-select-dropdown"
            />
          </div>
          <div>
            <p className="text-[#202020] font-medium text-sm">Amount</p>
            <InputNumber
              className='w-[20rem] mb-[10px]'
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
      {message && openToast("bottom")}
    </Modal>
  );
};

export default TransferStratsModal;
