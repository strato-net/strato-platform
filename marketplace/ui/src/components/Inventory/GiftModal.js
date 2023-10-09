import { Button, Select, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as itemActions } from "../../contexts/item/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";


const GiftModal = ({ open, handleCancel, inventory }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [userAddress, setUserAddress] = useState("");
    const inventoryDispatch = useInventoryDispatch();
    const itemDispatch = useItemDispatch();
    const userDispatch = useUsersDispatch();
    const [canGift, setCanGift] = useState(true);
    // const {
    //     isReselling
    // } = useInventoryState();
    const {
        items
    } = useItemState();
    const {
        user
    } = useAuthenticateState();
    const {
        users
    } = useUsersState();

    const filterDuplicateUserAddresses = (arr) => {
        return [...new Map(arr.map((u) => [u.value, u])).values()];
    };
    
    const usersList = users.map((record) => (user.organization !== record.organization ? { label: `${record.commonName} - ${record.organization}`, value: record.userAddress } : {}));
    const filteredUsersList = filterDuplicateUserAddresses(usersList);

    const handleSelect = (userAddress) => {
        setUserAddress(userAddress);
    }

    useEffect(() => {
        itemActions.fetchItem(itemDispatch, "", 0, inventory.address);
        userActions.fetchUsers(userDispatch);
    }, [])

    useEffect(() => {
        if (quantity > inventory.availableQuantity || quantity <= 0) {
            setCanGift(false);
        }
        else {
            setCanGift(true);
        };
    }, [quantity])

    const columns = [
        {
            title: "Quantity Available",
            dataIndex: "availableQuantity",
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
        const itemsAddress = items.map((item) => item.address)

        const body = {
            inventoryId: inventory.address,
            quantity: quantity,
            itemsAddress: itemsAddress,
            userAddress: userAddress
        };
        if (quantity > 0 && quantity <= inventory.availableQuantity) {
            console.log("Gift", body);
            // let isDone = await actions.resellInventory(inventoryDispatch, body);
            // if (isDone) {
            //     actions.fetchInventory(inventoryDispatch, 10, 0, "");
            //     handleCancel();
            // }
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Gift - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canGift} loading={false}>
                    Gift
                </Button>
            ]}
        >
            <Table
                columns={columns}
                dataSource={data}
                pagination={false}
            />
        </Modal>
    )
}


export default GiftModal;