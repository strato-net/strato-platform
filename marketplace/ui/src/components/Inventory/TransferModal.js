import { Button, Select, InputNumber, Modal, Table, notification } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { SearchOutlined, DeleteOutlined } from "@ant-design/icons";
import { OLD_SADDOG_ORIGIN_ADDRESS } from "../../helpers/constants";

const TransferModal = ({
  open,
  handleCancel,
  inventory,
  categoryName = "",
  limit = 0,
  offset = 0,
}) => {
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
  const quantityIsDecimal =
    inventory.data.quantityIsDecimal &&
    inventory.data.quantityIsDecimal === "True";
  const [transfers, setTransfers] = useState([
    {
      id: 1,
      quantity: 1,
      price: 0.01,
      recipient: undefined,
      openDropdown: false,
    },
  ]);

  // Mobile-specific section for a single transfer
  const mobileTransfer = transfers[0];

  // Functions to change Tansfer State
  const handleAddTransfer = () => {
    setTransfers((prevTransfers) => [
      ...prevTransfers,
      {
        id: transfers.length + 1,
        quantity: 1,
        price: 0.01,
        recipient: undefined,
        openDropdown: false,
      },
    ]);
    setTimeout(() => {
      const scrollRow = document.querySelector(".scroll-row");
      if (scrollRow) {
        scrollRow.scrollIntoView({ behavior: "smooth", block: "start" });
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
      const scrollRow = document.querySelector(".scroll-row");
      if (scrollRow) {
        scrollRow.scrollIntoView({ behavior: "smooth", block: "start" });
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
        ? record.commonName.toLowerCase() === "burner"
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
    const totalQuantity = transfers.reduce(
      (total, transfer) => total + (transfer.quantity || 0),
      0
    );
    const availableQuantity = quantityIsDecimal
      ? inventory.quantity / 100
      : inventory.quantity;

    setCanTransfer(isValidTransfer && totalQuantity <= availableQuantity);
    setCanAddRow(
      transfers.length < 10 &&
        totalQuantity < availableQuantity &&
        isValidTransfer
    );
    setCanRemoveRow(transfers.length > 1);
  }, [transfers, inventory, quantityIsDecimal]);

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
    const stringValue = value ? value.toString() : "";
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
      const recipientCommonName = user ? user.label.split("-")[0].trim() : "";

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
      title: "Quantity Available",
      dataIndex: "quantity",
      align: "center",
      width: 150,
      render: (_, record, index) => {
        // Calculate the quantity available for each row
        const availableQuantity = quantityIsDecimal
          ? inventory.quantity / 100
          : inventory.quantity;
        const allocatedQuantity = transfers
          .slice(0, index)
          .reduce((total, transfer) => total + (transfer.quantity || 0), 0);
        return availableQuantity - allocatedQuantity;
      },
    },
    {
      title: "Set Quantity",
      align: "center",
      render: (record, _, index) => (
        <InputNumber
          value={record.quantity}
          controls={false}
          min={1}
          max={(() => {
            // Calculate available quantity for this record
            const availableQuantity = quantityIsDecimal
              ? inventory.quantity / 100
              : inventory.quantity;
            const allocatedQuantity = transfers
              .slice(0, index)
              .reduce((total, transfer) => total + (transfer.quantity || 0), 0);
            return availableQuantity - allocatedQuantity;
          })()}
          step={1}
          precision={0}
          onChange={(value) => handleQuantityChange(record.id, value)}
          disabled={index !== transfers.length - 1}
        />
      ),
    },
    {
      title: "Unit Price ($)",
      align: "center",
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
      title: "Select Recipient",
      align: "center",
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
            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
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
      quantity: quantityIsDecimal ? transfer.quantity * 100 : transfer.quantity,
      price: quantityIsDecimal ? transfer.price / 100 : transfer.price,
      senderCommonName: user.commonName,
      recipientCommonName: transfer.recipientCommonName,
      itemName,
    }));

    isDone = await actions.transferInventory(inventoryDispatch, body);
    if (isDone) {
      await actions.fetchInventory(
        inventoryDispatch,
        limit,
        offset,
        "",
        categoryName
      );
      await actions.fetchInventoryForUser(inventoryDispatch, user.commonName);
      await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
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
            index === transfers.length - 1 ? "scroll-row" : ""
          }
          columns={columns}
          dataSource={transfers}
          pagination={false}
          scroll={{
            x: "max-content",
            y: 300,
          }}
        />
      </div>

      {/* Mobile View */}
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          {" "}
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p>
              {quantityIsDecimal
                ? inventory.quantity / 100
                : inventory.quantity}
            </p>
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={mobileTransfer.quantity}
              controls={false}
              min={1}
              max={
                quantityIsDecimal
                  ? inventory.quantity / 100
                  : inventory.quantity
              }
              step={1}
              onChange={(value) =>
                handleQuantityChange(mobileTransfer.id, value)
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
              (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
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
      {marketplaceMsg && marketplaceToast("bottom")}
    </Modal>
  );
};

export default TransferModal;
