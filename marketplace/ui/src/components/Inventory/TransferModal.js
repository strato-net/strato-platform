import { Button, Select, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { SearchOutlined } from '@ant-design/icons';

const TransferModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [userAddress, setUserAddress] = useState("");
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
    }, [])

    useEffect(() => {
        if (quantity > inventory.quantity || quantity <= 0 || !userAddress) {
            setCanTransfer(false);
        }
        else {
            setCanTransfer(true);
        };
    }, [quantity, userAddress])
    
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
                <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
            )
        },
        {
            title: "Select recipient",
            align: "center",
            render: () => (
                <Select
                    className="w-[440px]"
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
                />
            )
        }
    ];


    const handleSubmit = async () => {
        const body = {
            assetAddress: inventory.address,
            newOwner: userAddress,
            quantity
        };

        if (quantity > 0 && quantity <= inventory.quantity && userAddress) {
            let isDone = await actions.transferInventory(inventoryDispatch, body);
            if (isDone) {
                await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
                handleCancel();
            }
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Transfer - ${decodeURIComponent(inventory.name)}`}
            width={825}
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
                    <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center ">

                        <p className="px-5 "> {inventory?.quantity}</p>
                    </div>
                </div>
                <div>

                    <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
                    <div className="inventory_card">
                        <InputNumber className="w-full pl-5" value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
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
                    />
                </div>

            </div>
        </Modal>
    )
}


export default TransferModal;