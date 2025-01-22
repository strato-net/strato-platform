import { Button, Select, InputNumber, Modal, Table, notification } from 'antd';
import { useEffect, useState } from 'react';
import BigNumber from 'bignumber.js';
import { actions } from '../../contexts/inventory/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as userActions } from '../../contexts/users/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useUsersDispatch, useUsersState } from '../../contexts/users';
import { useAuthenticateState } from '../../contexts/authentication';
import { SearchOutlined, DeleteOutlined } from '@ant-design/icons';
import { OLD_SADDOG_ORIGIN_ADDRESS } from '../../helpers/constants';
import { useLocation } from 'react-router-dom';

const TransferModal = ({
  open,
  handleCancel,
  inventory,
  categoryName = '',
  limit = 0,
  offset = 0,
  reserves,
  assetsWithEighteenDecimalPlaces,
}) => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
    inventory.originAddress
  );
  const availableQuantity = is18DecimalPlaces
    ? new BigNumber(inventory.quantity).dividedBy(new BigNumber(10).pow(18))
    : new BigNumber(inventory.quantity);
  // Get the inventory state and dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const userDispatch = useUsersDispatch();
  const { user } = useAuthenticateState();
  const { users } = useUsersState();
  const { isTransferring } = useInventoryState();
  const { message: marketplaceMsg, success: marketplaceSuccess } =
    useMarketplaceState();

  // Notification context
  const [api, contextHolder] = notification.useNotification();

  // Local states
  const [canTransfer, setCanTransfer] = useState(false);
  const [canAddRow, setCanAddRow] = useState(false);
  const [canRemoveRow, setCanRemoveRow] = useState(false);
  const [transfers, setTransfers] = useState([
    {
      id: 1,
      quantity: availableQuantity,
      price: 0.01,
      recipient: undefined,
      openDropdown: false,
    },
  ]);

  // Mobile-specific section for a single transfer
  const mobileTransfer = transfers[0];

  // Functions to change Tansfer State
  const handleAddTransfer = () => {
    // Calculate allocated quantity from previous transfers
    const allocatedQuantity = transfers.reduce(
      (total, transfer) =>
        new BigNumber(total).plus(new BigNumber(transfer.quantity || 0)),
      new BigNumber(0)
    );

    // Calculate remaining quantity
    const remainingQuantity = availableQuantity.minus(allocatedQuantity);

    // Prevent adding transfer if no available quantity remains
    if (remainingQuantity <= 0) {
      console.warn('No remaining quantity available for transfer.');
      return;
    }

    // Update transfers state
    setTransfers((prevTransfers) => [
      ...prevTransfers,
      {
        id: prevTransfers.length + 1,
        quantity: remainingQuantity, // TODO: cast to string for testing big numbers to remove trailing zeros
        price: 0.01,
        recipient: undefined,
        openDropdown: false,
      },
    ]);
    setTimeout(() => {
      const scrollRow = document.querySelector('.scroll-row');
      if (scrollRow) {
        scrollRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  };

  const handleRemoveTransfer = (id) => {
    setTransfers((prevTransfers) => {
      const updatedTransfers = prevTransfers.filter(
        (transfer) => transfer.id !== id
      );
      return updatedTransfers.map((transfer, index) => ({
        ...transfer,
        id: index + 1,
      }));
    });
    setTimeout(() => {
      const scrollRow = document.querySelector('.scroll-row');
      if (scrollRow) {
        scrollRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  };

  // User list filtering
  const filterDuplicateUserAddresses = (arr) => {
    return [...new Map(arr.map((u) => [u.value, u])).values()];
  };

  const originAddress = inventory.originAddress?.toLowerCase();
  const isBurner = originAddress === OLD_SADDOG_ORIGIN_ADDRESS;
  const itemName = decodeURIComponent(inventory.name);

  const usersList = users
    .filter((record) =>
      isBurner
        ? record.commonName.toLowerCase() === 'burner'
        : user.commonName !== record.commonName
    )
    .map((record) => ({
      label: isBurner
        ? `burner - ${record.organization}`
        : `${record.commonName} - ${record.organization}`,
      value: record.userAddress,
    }));

  const filteredUsersList = filterDuplicateUserAddresses(usersList);

  // Notification for marketplace
  const marketplaceToast = (placement) => {
    if (marketplaceSuccess) {
      api.success({
        message: marketplaceMsg,
        onClose: marketplaceActions.resetMessage(marketplaceDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: marketplaceMsg,
        onClose: marketplaceActions.resetMessage(marketplaceDispatch),
        placement,
        key: 2,
      });
    }
  };

  useEffect(() => {
    userActions.fetchUsers(userDispatch);
  }, []);

  useEffect(() => {
    const isValidTransfer = transfers.every(
      (transfer) =>
        transfer.quantity > 0 && transfer.price > 0 && transfer.recipient
    );
    const allocatedQuantity = transfers.reduce(
      (total, transfer) =>
        new BigNumber(total).plus(new BigNumber(transfer.quantity || 0)),
      new BigNumber(0)
    );

    setCanTransfer(isValidTransfer && allocatedQuantity.lte(availableQuantity));
    setCanAddRow(
      transfers.length < 10 &&
        allocatedQuantity.lt(availableQuantity) &&
        isValidTransfer
    );
    setCanRemoveRow(transfers.length > 1);
  }, [transfers, inventory]);

  // Helper function to handle quantity change
  const handleQuantityChange = (id, value) => {
    if (!value) return;

    setTransfers((transfers) => {
      return transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, quantity: value } : transfer
      );
    });
  };

  // Helper function to handle price change
  const handlePriceChange = (id, value) => {
    const stringValue = value ? value.toString() : '';
    if (!/^\d+(\.\d{0,2})?$/.test(stringValue)) return;

    setTransfers((transfers) => {
      return transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, price: value } : transfer
      );
    });
  };

  // Helper function to handle recipient selection
  const handleRecipientSelect = (id, value) => {
    setTransfers((transfers) => {
      const user = filteredUsersList.find((item) => item.value === value);
      const recipientCommonName = user ? user.label.split('-')[0].trim() : '';

      return transfers.map((transfer) =>
        transfer.id === id
          ? {
              ...transfer,
              recipient: value,
              recipientCommonName,
              openDropdown: false,
            }
          : transfer
      );
    });
  };

  // Helper function to handle dropdown open state
  const handleDropdownOpenChange = (id, isOpen) => {
    setTransfers((transfers) =>
      transfers.map((transfer) =>
        transfer.id === id
          ? { ...transfer, openDropdown: isOpen }
          : { ...transfer, openDropdown: false }
      )
    );
  };

  // Helper function to handle search input change
  const handleSearchChange = (id, value) => {
    setTransfers((transfers) =>
      transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, openDropdown: !!value } : transfer
      )
    );
  };

  // Columns definition
  const columns = [
    {
      title: 'Quantity Available',
      dataIndex: 'quantity',
      align: 'center',
      width: 175,
      render: (_, __, index) => {
        const allocatedQuantity = new BigNumber(
          transfers
            .slice(0, index)
            .reduce(
              (total, transfer) =>
                total.plus(new BigNumber(transfer.quantity || 0)),
              new BigNumber(0)
            )
        );
        return availableQuantity.minus(allocatedQuantity).toString();
      },
    },
    {
      title: 'Set Quantity',
      align: 'center',
      render: (record, _, index) => (
        <InputNumber
          value={record.quantity}
          controls={false}
          max={(() => {
            const allocatedQuantity = new BigNumber(
              transfers
                .slice(0, index)
                .reduce(
                  (total, transfer) =>
                    total.plus(new BigNumber(transfer.quantity || 0)),
                  new BigNumber(0)
                )
            );
            return availableQuantity.minus(allocatedQuantity);
          })()}
          onChange={(value) =>
            handleQuantityChange(record.id, new BigNumber(value))
          }
          disabled={index !== transfers.length - 1}
        />
      ),
    },
    {
      title: <span className="whitespace-nowrap">Unit Price ($)</span>,
      align: 'center',
      render: (record, _, index) => (
        <InputNumber
          value={record.price}
          controls={false}
          min={0.01}
          onChange={(value) => handlePriceChange(record.id, value)}
          disabled={index !== transfers.length - 1}
        />
      ),
    },
    {
      title: 'Select Recipient',
      align: 'center',
      render: (record, _, index) => (
        <Select
          className="transfer_modal w-[390px]"
          showSearch
          value={record.recipient}
          onSelect={(value) => handleRecipientSelect(record.id, value)}
          onSearch={(value) => handleSearchChange(record.id, value)}
          options={filteredUsersList}
          optionFilterProp="value"
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          open={record.openDropdown}
          suffixIcon={<SearchOutlined />}
          onFocus={() => handleDropdownOpenChange(record.id, false)}
          onBlur={() => handleDropdownOpenChange(record.id, false)}
          popupClassName="custom-select-dropdown"
          defaultValue={isBurner ? filteredUsersList[0] : null}
          disabled={index !== transfers.length - 1}
        />
      ),
    },
    {
      render: (record) => (
        <Button
          type="link"
          onClick={() => handleRemoveTransfer(record.id)}
          disabled={!canRemoveRow}
          icon={<DeleteOutlined />}
        />
      ),
    },
  ];

  const handleSubmit = async () => {
    let isDone = false;
    const body = transfers.map((transfer) => ({
      assetAddress: inventory.address,
      newOwner: transfer.recipient,
      quantity: (is18DecimalPlaces
        ? transfer.quantity.multipliedBy(new BigNumber(10).pow(18))
        : transfer.quantity
      ).toFixed(0),
      price: is18DecimalPlaces
        ? transfer.price / Math.pow(10, 18)
        : transfer.price,
      senderCommonName: user.commonName,
      recipientCommonName: transfer.recipientCommonName,
      itemName,
      decimal: (is18DecimalPlaces
        ? new BigNumber(10).pow(18)
        : new BigNumber(10)
      ).toString(),
    }));

    isDone = await actions.transferInventory(inventoryDispatch, body);
    if (isDone) {
      await actions.fetchInventory(
        inventoryDispatch,
        limit,
        offset,
        '',
        categoryName,
        queryParams.get('st') === 'true' ||
          window.location.pathname === '/stake'
          ? reserves.map((reserve) => reserve.assetRootAddress)
          : ''
      );
      await actions.fetchInventoryForUser(inventoryDispatch, user.commonName);
      await marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
    }

    if (isDone) {
      handleCancel();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={`Transfer - ${itemName}`}
      width={1000}
      footer={[
        <div className="flex flex-col md:flex-row md:justify-between">
          <div className="flex gap-4 hidden md:flex">
            <Button
              type="dashed"
              className="w-32 h-9"
              onClick={handleAddTransfer}
              disabled={!canAddRow}
            >
              Add
            </Button>
          </div>
          <div className="md:w-auto w-full flex md:justify-end justify-center mt-2 md:mt-0">
            <Button
              type="primary"
              className="w-full md:w-32 h-9"
              onClick={handleSubmit}
              disabled={!canTransfer}
              loading={isTransferring}
            >
              Transfer
            </Button>
          </div>
        </div>,
      ]}
    >
      {/* Desktop View */}
      <div className="head hidden md:block">
        <Table
          rowClassName={(record, index) =>
            index === transfers.length - 1 ? 'scroll-row' : ''
          }
          columns={columns}
          dataSource={transfers}
          pagination={false}
          scroll={{
            x: 'max-content',
            y: 300,
          }}
        />
      </div>

      {/* Mobile View */}
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          {' '}
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p>{availableQuantity.toString()}</p>
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={mobileTransfer.quantity}
              controls={false}
              max={availableQuantity}
              step={1}
              onChange={(value) =>
                handleQuantityChange(mobileTransfer.id, new BigNumber(value))
              }
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Unit Price ($)</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={mobileTransfer.price}
              controls={false}
              min={0.01}
              onChange={(value) => handlePriceChange(mobileTransfer.id, value)}
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Select recipient</p>
          <Select
            className="w-full"
            showSearch
            onSelect={(value) =>
              handleRecipientSelect(mobileTransfer.id, value)
            }
            options={filteredUsersList}
            optionFilterProp="value"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            open={mobileTransfer.openDropdown}
            suffixIcon={<SearchOutlined />}
            onFocus={() => handleDropdownOpenChange(mobileTransfer.id, true)}
            onBlur={() => handleDropdownOpenChange(mobileTransfer.id, false)}
            popupClassName="custom-select-dropdown"
            defaultValue={isBurner ? filteredUsersList[0] : null}
          />
        </div>
      </div>
      {contextHolder}
      {marketplaceMsg && marketplaceToast('bottom')}
    </Modal>
  );
};

export default TransferModal;
