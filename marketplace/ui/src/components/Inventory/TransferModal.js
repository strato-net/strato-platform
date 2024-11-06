import { Button, Select, InputNumber, Modal, Table, notification } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { SearchOutlined } from '@ant-design/icons';
import { handlePriceInput, handleQuantityInput } from "../../helpers/utils";
import { OLD_SADDOG_ORIGIN_ADDRESS } from "../../helpers/constants";

const TransferModal = ({ open, handleCancel, inventory, categoryName = "", limit = 0, offset = 0 }) => {
    const [data, setData] = useState(inventory);
    const [quantity, setQuantity] = useState(1);
    const [price, setPrice] = useState(0);
    const inventoryDispatch = useInventoryDispatch();
    const marketplaceDispatch = useMarketplaceDispatch();
    const userDispatch = useUsersDispatch();
    const [api, contextHolder] = notification.useNotification();
    const [canTransfer, setCanTransfer] = useState(true);
    const quantityIsDecimal = data.data.quantityIsDecimal && data.data.quantityIsDecimal === "True";
    const {
        user
    } = useAuthenticateState();
    const {
        users
    } = useUsersState();
    const {
        isTransferring
    } = useInventoryState();
    const {
        message: marketplaceMsg, success: marketplaceSuccess
    } = useMarketplaceState();

    const filterDuplicateUserAddresses = (arr) => {
        return [...new Map(arr.map((u) => [u.value, u])).values()];
    };

    const [searchInput, setSearchInput] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [selectedRecipient, setSelectedRecipient] = useState('');

    const handleSearchChange = (value) => {
        setSearchInput(value);
        setDropdownOpen(!!value);
    };

    const originAddress = inventory.originAddress?.toLowerCase();
    const isBurner = originAddress === OLD_SADDOG_ORIGIN_ADDRESS;
    const itemName = decodeURIComponent(inventory.name)

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

    const handleSelect = (userAddress) => {
        setUserAddress(userAddress);
        const user = filteredOptions.find(item => item.value === userAddress);
        const recipientCommonName = user.label.split('-')[0].trim()
        setSelectedRecipient(recipientCommonName)
        setDropdownOpen(false);
    }

    useEffect(() => {
        userActions.fetchUsers(userDispatch);
    }, []);

    useEffect(() => {
        if (quantity > (quantityIsDecimal ? inventory.quantity / 100 : inventory.quantity) || quantity <= 0 || !userAddress) {
            setCanTransfer(false);
        }
        else {
            setCanTransfer(true);
        };
    }, [quantity, userAddress]);

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
            render: (text, record) => quantityIsDecimal ? record.quantity / 100 : record.quantity,
        },
        {
            title: "Set Quantity",
            align: "center",
            render: () => (
                <InputNumber
                    value={quantity}
                    controls={false}
                    min={1}
                    max={inventory.quantity}
                    onChange={(value) => setQuantity(value)}
                    precision={0}
                />
            )
        },
        {
            title: "Unit Price ($)",
            align: "center",
            render: () => (
                <InputNumber
                    value={price}
                    controls={false}
                    min={0.01}
                    onChange={(value) => setPrice(value)}
                    precision={2}
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
        if (quantity > 0 && quantity <= (quantityIsDecimal ? inventory.quantity / 100 : inventory.quantity) && userAddress) {
            let isDone = false;

            const body = {
                assetAddress: inventory.address,
                newOwner: userAddress,
                quantity: quantityIsDecimal ? quantity * 100 : quantity,
                price: quantityIsDecimal ? price / 100 : price,
                senderCommonName:user.commonName,
                recipientCommonName:selectedRecipient,
                itemName,
            };
            isDone = await actions.transferInventory(inventoryDispatch, body);
            if (isDone) {
                await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
                await actions.fetchInventoryForUser(inventoryDispatch, user.commonName);
                await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
            }

            if (isDone) {
                handleCancel();
            }
        }
    };

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Transfer - ${itemName}`}
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
                    dataSource={[data]}
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
                            controls={false}
                            min={1}
                            max={inventory.quantity}
                            onChange={(value) => setQuantity(value)}
                            precision={0}
                        />
                    </div>
                </div>
                <div>
                    <p className="text-[#202020] font-medium text-sm">Unit Price ($)</p>
                    <div>
                        <InputNumber
                            className="w-full h-9"
                            value={price}
                            controls={false}
                            min={.01}
                            onChange={(value) => setPrice(value)}
                            precision={2}
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
            {contextHolder}
            {marketplaceMsg && marketplaceToast("bottom")}
        </Modal>
    )
}


export default TransferModal;