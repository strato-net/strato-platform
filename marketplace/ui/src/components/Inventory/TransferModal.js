import { Button, Select, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";

const TransferModal = ({ open, handleCancel, inventory }) => {
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

    const usersList = users.map((record) => (user.commonName !== record.commonName ? { label: `${record.commonName} - ${record.organization}`, value: record.userAddress } : {}));
    const filteredUsersList = filterDuplicateUserAddresses(usersList);

    const handleSelect = (userAddress) => {
        setUserAddress(userAddress);
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
                    className="w-64"
                    showSearch
                    onSelect={handleSelect}
                    options={filteredUsersList}
                    optionFilterProp="value"
                    filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
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
                actions.fetchInventory(inventoryDispatch, 10, 0, "", undefined);
                handleCancel();
            }
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Transfer - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canTransfer} loading={isTransferring}>
                    Transfer
                </Button>
            ]}
        >
            <div className="head">

            <Table
                columns={columns}
                dataSource={data}
                pagination={false}
            />
            </div>
        </Modal>
    )
}


export default TransferModal;