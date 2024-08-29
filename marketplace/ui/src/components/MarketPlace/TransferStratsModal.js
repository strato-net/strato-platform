import React, { useState, useRef, useEffect } from 'react';
import { Button, Table, InputNumber, Modal, Select, notification } from 'antd';
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { SearchOutlined } from "@ant-design/icons";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { handlePriceInput, handleQuantityInput } from "../../helpers/utils";

const TransferStratsModal = ({ visible, onCancel, balance }) => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const [data, setData] = useState([{ quantity: balance }]);
  const { isTransferringStrats, strats, message, success } =
    useMarketplaceState();
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
  const [price, setPrice] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [canTransfer, setCanTransfer] = useState(true);
  const [api, contextHolder] = notification.useNotification();

  const inputPriceDesktopRef = useRef(null);
  const inputPriceMobileRef = useRef(null);
  const inputQuantityDesktopRef = useRef(null);
  const inputQuantityMobileRef = useRef(null);

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

  useEffect(() => {
    const priceInputElements = [
      inputPriceDesktopRef.current,
      inputPriceMobileRef.current,
    ];
    const quantityInputElements = [
      inputQuantityDesktopRef.current,
      inputQuantityMobileRef.current,
    ];

    priceInputElements.forEach((inputElement) => {
      if (inputElement) {
        inputElement.addEventListener("input", handlePriceInput(setPrice));
      }
    });

    quantityInputElements.forEach((inputElement) => {
      if (inputElement) {
        inputElement.addEventListener(
          "input",
          handleQuantityInput(setAmount)
        );
      }
    });

    return () => {
      priceInputElements.forEach((inputElement) => {
        if (inputElement) {
          inputElement.removeEventListener("input", handlePriceInput(setPrice));
        }
      });

      quantityInputElements.forEach((inputElement) => {
        if (inputElement) {
          inputElement.removeEventListener(
            "input",
            handleQuantityInput(setAmount)
          );
        }
      });
    };
  }, [
    inputPriceDesktopRef,
    inputPriceMobileRef,
    inputQuantityDesktopRef,
    inputQuantityMobileRef,
  ]);

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
      value: amount !== undefined ? amount : 0,
      price,
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

  const columns = [
    {
      title: "Quantity Available",
      dataIndex: "quantity",
      align: "center",
    },
    {
      title: "Set Quantity",
      align: "center",
      render: () => (
        <InputNumber
          value={amount}
          ref={inputQuantityDesktopRef}
          controls={false}
          min={1}
          onChange={(value) => {
            if (value) {
              setAmount(parseInt(value, 10));
            }
          }}
        />
      ),
    },
    {
      title: "Unit Price ($)",
      align: "center",
      render: () => (
        <InputNumber
          ref={inputPriceDesktopRef}
          value={price}
          controls={false}
          min={0.01}
          onChange={(value) => {
            const stringValue = value ? value.toString() : '';
            if (/^\d+(\.\d{0,2})?$/.test(stringValue)) {
              setPrice(value);
            }
          }}
        />
      ),
    },
    {
      title: "Select recipient",
      align: "center",
      render: () => (
        <Select
          className="w-[390px]"
          showSearch
          onSelect={handleSelect}
          onSearch={onSearch}
          options={filteredOptions}
          optionFilterProp="value"
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          open={dropdownOpen}
          suffixIcon={<SearchOutlined />}
          onFocus={() => setDropdownOpen(!!searchInput)} // Open dropdown on focus if there is any input
          onBlur={() => setDropdownOpen(false)} // Close dropdown on blur
          popupClassName="custom-select-dropdown" // Add this line
        />
      ),
    },
  ];

  return (
    <Modal
      title="Transfer STRATS"
      open={visible}
      onCancel={handleCancel}
      width={1000}
      footer={[
        <Button key="submit" type="primary" onClick={handleSubmit} loading={isTransferringStrats} disabled={!canTransfer}>
          Submit
        </Button>,
      ]}
    >
      {contextHolder}
      <div className="head hidden md:block">
        <Table columns={columns} dataSource={data} pagination={false} />
      </div>
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          {" "}
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p> {strats}</p>
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={amount}
              ref={inputQuantityMobileRef}
              controls={false}
              min={1}
              onChange={(value) => {
                if (value) {
                  setAmount(parseInt(value, 10));
                }
              }}
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Unit Price ($)</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={price}
              ref={inputPriceMobileRef}
              controls={false}
              min={0.01}
              onChange={(value) => {
                const stringValue = value ? value.toString() : '';
                if (/^\d+(\.\d{0,2})?$/.test(stringValue)) {
                  setPrice(value);
                }
              }}
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Select recipient</p>
          <Select
            className="w-full"
            showSearch
            onSelect={handleSelect}
            onSearch={onSearch}
            options={filteredOptions}
            optionFilterProp="value"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            open={dropdownOpen}
            suffixIcon={<SearchOutlined />}
            onFocus={() => setDropdownOpen(!!searchInput)} // Open dropdown on focus if there is any input
            onBlur={() => setDropdownOpen(false)} // Close dropdown on blur
            popupClassName="custom-select-dropdown"
          />
        </div>
      </div>
      {message && openToast("bottom")}
    </Modal>
  );
};

export default TransferStratsModal;
