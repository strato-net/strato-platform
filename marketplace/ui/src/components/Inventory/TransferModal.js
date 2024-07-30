import { Button, Select, InputNumber, Modal, Table, Input, Typography, Progress, Spin } from "antd";
import React, { useState, useEffect } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { SearchOutlined } from '@ant-design/icons';
import { handlePriceInput, handleQuantityInput } from "../../helpers/utils";

const TransferModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    const [view, setView] = useState("options");
    const [quantity, setQuantity] = useState(1);
    const [price, setPrice] = useState(0);
    const [userAddress, setUserAddress] = useState("");
    const [bridgeAddress, setBridgeAddress] = useState("");
    const inventoryDispatch = useInventoryDispatch();
    const userDispatch = useUsersDispatch();
    const [canTransfer, setCanTransfer] = useState(true);
    const [canBridge, setCanBridge] = useState(true);
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

    const usersList = users.map((record) => (user.commonName !== record.commonName ? { label: `${record.commonName} - ${record.organization}`, value: record.userAddress } : {}));
    const filteredUsersList = filterDuplicateUserAddresses(usersList);

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


    const renderTransfer = () => (
        <>
            <Table
                columns={[
                    {
                        title: "Quantity Available",
                        dataIndex: "quantity",
                        align: "center"
                    },
                    {
                        title: "Set Quantity",
                        align: "center",
                        render: () => (
                            <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
                        )
                    },
                    {
                        title: "Set Price",
                        align: "center",
                        render: () => (
                            <InputNumber value={price} controls={false} min={1} onChange={(value) => setPrice(value)} />
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
                                onFocus={() => setDropdownOpen(!!searchInput)}
                                onBlur={() => setDropdownOpen(false)}
                                popupClassName="custom-select-dropdown"
                            />
                        )
                    }
                ]}
                dataSource={[inventory]}
                pagination={false}
            />
            <div className="flex justify-center md:block">
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canTransfer} loading={isTransferring}>
                    Transfer
                </Button>
            </div>
        </>
    );
    
    const renderBridge = () => (
        <>
            <Table
                columns={[
                    {
                        title: "Quantity Available",
                        dataIndex: "quantity",
                        align: "center"
                    },
                    {
                        title: "Set Quantity",
                        align: "center",
                        render: () => (
                            <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
                        )
                    },
                    {
                        title: "Base Chain Address",
                        align: "center",
                        render: () => (
                            <Input 
                                placeholder="Base Chain address" 
                                value={bridgeAddress} 
                                onChange={(e) => setBridgeAddress(e.target.value)} 
                                className="mt-2"
                            />
                        )
                    }
                ]}
                dataSource={[inventory]}
                pagination={false}
            />
            <div className="flex justify-center md:block">
                <Button type="primary" className="w-32 h-9" onClick={handleBridge} disabled={!canBridge} loading={isTransferring}>
                    Bridge
                </Button>
            </div>
        </>
    );

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
    
    const handleBridge = async () => {
        const body = {
            rootAddress: inventory.root,
            assetAddress: inventory.address,
            quantity,
            price,
            baseAddress: bridgeAddress,
            mercataAddress: inventory.owner
        };

        if (quantity > 0 && quantity <= inventory.quantity && bridgeAddress) {
            let isDone = await actions.bridgeInventory(inventoryDispatch, body);
            if (isDone) {
                await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
                await actions.fetchInventoryForUser(inventoryDispatch, user.commonName);
                handleCancel();
            }
        }
    }
    
    const renderOptions = () => (
        <div className="flex justify-around">
            <Button type="primary" onClick={() => setView("transfer")}>Transfer</Button>
            <Button type="primary" onClick={() => setView("bridge")}>Bridge</Button>
        </div>
    );

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Transfer - ${decodeURIComponent(inventory.name)}`}
            width={825}
            footer={null}
        >
            {inventory.name === "token test 2" ? (
                view === "options" ? renderOptions() : view === "transfer" ? renderTransfer() : renderBridge()
            ) : (
                renderTransfer()
            )}
        </Modal>
    )
}


export default TransferModal;