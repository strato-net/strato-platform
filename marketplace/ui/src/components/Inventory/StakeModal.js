import { Button, Select, InputNumber, Modal, Table, notification } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { OLD_SADDOG_ORIGIN_ADDRESS } from "../../helpers/constants";
import { Images } from "../../images";
const logo = <img src={Images.logo} alt={''} title={''} className=" ml-1 mt-1 w-[15px] h-[15px] " />

const StakeModal = ({ open, handleCancel, inventory, category, debouncedSearchTerm, limit = 0, offset = 0, type }) => {
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
    const [selectedRecipient, setSelectedRecipient] = useState('');

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

    const columns = [
        {
            title: `Quantity ${type === 'Stake' ? 'Available' : 'to Unstake'}`,
            dataIndex: "quantity",
            align: "center",
            render: (text, record) => quantityIsDecimal ? record.quantity / 100 : record.quantity,
        },
        {
            title: "Liquidity",
            align: "center",
            render: () => (
                <div className="flex justify-center"> <div className="flex mx-auto">3000 {logo} </div> </div> // hardcoded STRATs
            )
        },
        {
            title: "Actions",
            align: "center",
            render: () => (
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={false} loading={isTransferring}>
                         {type}
                </Button>
            )
        }
    ];


    const handleSubmit = async () => {
        if (quantity > 0 && quantity <= (quantityIsDecimal ? inventory.quantity / 100 : inventory.quantity) && userAddress) {
            let isDone = false;

            const body = {
                // Add payload for Staking / Unstaking assets
            };
            if(type === 'Stake'){
             // call stake API
            }
            if(type === 'Unstake'){
             // call unstake API 
            }
            // isDone = await actions.transferInventory(inventoryDispatch, body);
            // if (isDone) {
            //     await actions.fetchInventory(inventoryDispatch, limit, offset, debouncedSearchTerm, category && category !== "All" ? category : undefined);
            //     await actions.fetchInventoryForUser(inventoryDispatch, limit, offset, debouncedSearchTerm, category && category !== "All" ? category : undefined);
            //     await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
            // }

            // if (isDone) {
            //     handleCancel();
            // }
        }
    };

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`${type} - ${itemName}`}
            width={1000}
            footer={[
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
                    <p className="text-[#202020] font-medium text-sm">Liquidity</p>
                    <div>
                       30000 STRATs
                    </div>
                </div>
                <div>
                    <p className="text-[#202020] font-medium text-sm">Action</p>
                    <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canTransfer} loading={isTransferring}>
                        Transfer
                    </Button>
                </div>

            </div>
            {contextHolder}
            {marketplaceMsg && marketplaceToast("bottom")}
        </Modal>
    )
}

export default StakeModal;
