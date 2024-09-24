import { Button, Select, InputNumber, Modal, Table } from "antd";
import { useEffect, useRef,useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { SearchOutlined } from '@ant-design/icons';
import { handlePriceInput, handleQuantityInput } from "../../helpers/utils";
import { OLD_SADDOG_ORIGIN_ADDRESS } from "../../helpers/constants";

const TransferModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [price, setPrice] = useState(0);
    const inventoryDispatch = useInventoryDispatch();
    const userDispatch = useUsersDispatch();
    const [canTransfer, setCanTransfer] = useState(true);
    const {
        user
    } = useAuthenticateState();
    const {
        users
    } = useUsersState();
    const {
        isTransferring
    } = useInventoryState();
    const inputPriceDesktopRef = useRef(null);
    const inputPriceMobileRef = useRef(null);
    const inputQuantityDesktopRef = useRef(null);
    const inputQuantityMobileRef = useRef(null);

    const filterDuplicateUserAddresses = (arr) => {
        return [...new Map(arr.map((u) => [u.value, u])).values()];
    };

    const [searchInput, setSearchInput] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const handleSearchChange = (value) => {
        setSearchInput(value);
        setDropdownOpen(!!value);
    };

    const originAddress = inventory.originAddress.toLowerCase();
    const isBurner = originAddress === OLD_SADDOG_ORIGIN_ADDRESS;

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
    const [userAddress, setUserAddress] = useState(
      isBurner && filteredUsersList.length > 0 ? filteredUsersList[0].value : ""
    );
    
    const handleSelect = (userAddress) => {
        setUserAddress(userAddress);

        setDropdownOpen(false);
    }

    useEffect(() => {
        userActions.fetchUsers(userDispatch);
    }, []);

    useEffect(() => {
        if (quantity > inventory.quantity || quantity <= 0 || !userAddress) {
            setCanTransfer(false);
        }
        else {
            setCanTransfer(true);
        };
    }, [quantity, userAddress]);

    useEffect(() => {
        const priceInputElements = [inputPriceDesktopRef.current, inputPriceMobileRef.current];
        const quantityInputElements = [inputQuantityDesktopRef.current, inputQuantityMobileRef.current];
        
        priceInputElements.forEach(inputElement => {
            if (inputElement) {
                inputElement.addEventListener('input', handlePriceInput(setPrice));
            }
        });

        quantityInputElements.forEach(inputElement => {
            if (inputElement) {
                inputElement.addEventListener('input', handleQuantityInput(setQuantity));
            }
        });

        return () => {
            priceInputElements.forEach(inputElement => {
                if (inputElement) {
                    inputElement.removeEventListener('input', handlePriceInput(setPrice));
                }
            });

            quantityInputElements.forEach(inputElement => {
                if (inputElement) {
                    inputElement.removeEventListener('input', handleQuantityInput(setQuantity));
                }
            });
        };
    }, [inputPriceDesktopRef, inputPriceMobileRef, inputQuantityDesktopRef, inputQuantityMobileRef]);

    const filteredOptions = searchInput
        ? filteredUsersList.filter(option =>
            option.label && option.label.toLowerCase().includes(searchInput.toLowerCase())
        )
        : [];


    const columns = [
        {
            title: "Quantity Available",
            dataIndex: "quantity",
            align: "center"
        },
        {
            title: "Set Quantity",
            align: "center",
            render: () => (
                <InputNumber
                    value={quantity}
                    ref={inputQuantityDesktopRef}
                    controls={false}
                    min={1}
                    onChange={(value) => {
                        if (value) {
                            setQuantity(parseInt(value, 10));
                        }
                    }}
                />
            )
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
            )
        },
        {
            title: "Select recipient",
            align: "center",
            render: () => (
                <Select
                    className="w-[390px]"
                    showSearch
                    onSelect={handleSelect}
                    onSearch={handleSearchChange}
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
                    defaultValue={isBurner ? filteredUsersList[0] : null}
                />
            )
        }
    ];


    const handleSubmit = async () => {
        const body = {
            assetAddress: inventory.address,
            newOwner: userAddress,
            quantity,
            price
        };

        if (quantity > 0 && quantity <= inventory.quantity && userAddress) {
            let isDone = await actions.transferInventory(inventoryDispatch, body);
            if (isDone) {
                await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
                await actions.fetchInventoryForUser(inventoryDispatch, user.commonName);
                handleCancel();
            }
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Transfer - ${decodeURIComponent(inventory.name)}`}
            width={1000}
            footer={[
                <div className="flex justify-center md:block">
                    <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canTransfer} loading={isTransferring}>
                        Transfer
                    </Button>
                </div>
            ]}
        >
            <div className="head hidden md:block">

                <Table
                    columns={columns}
                    dataSource={data}
                    pagination={false}
                />
            </div>
            <div className="flex flex-col gap-[18px] md:hidden mt-5">
                <div> <p className="text-[#202020] font-medium text-sm">Quantity Available</p>
                    <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
                        <p> {inventory?.quantity}</p>
                    </div>
                </div>
                <div>
                    <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
                    <div>
                        <InputNumber
                            className="w-full h-9"
                            value={quantity}
                            ref={inputQuantityMobileRef}
                            controls={false}
                            min={1}
                            onChange={(value) => {
                                if (value) {
                                    setQuantity(parseInt(value, 10));
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
                            min={.01}
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
                        onSearch={handleSearchChange}
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
                        defaultValue={isBurner ? filteredUsersList[0] : null}
                    />
                </div>

            </div>
        </Modal>
    )
}


export default TransferModal;