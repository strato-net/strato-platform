import { Button, Select, InputNumber, Modal, Table, notification } from "antd";
import { useEffect, useState } from "react";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import { useAuthenticateState } from "../../contexts/authentication";
import { Images } from "../../images";

const logo = <img src={Images.logo} alt={''} title={''} className=" ml-1 mt-1 w-[15px] h-[15px] " />

const StakeModal = ({ open, handleCancel, inventory, category, debouncedSearchTerm, limit = 0, offset = 0, type }) => {
    const [data, setData] = useState(inventory);
    const inventoryDispatch = useInventoryDispatch();
    const [api, contextHolder] = notification.useNotification();
    const quantityIsDecimal = data.data.quantityIsDecimal && data.data.quantityIsDecimal === "True";

    const originAddress = inventory.originAddress?.toLowerCase();
    const itemName = decodeURIComponent(inventory.name)

    // const filteredUsersList = filterDuplicateUserAddresses(usersList);
    // const [userAddress, setUserAddress] = useState(
    //     isBurner && filteredUsersList.length > 0 ? filteredUsersList[0].value : ""
    // );

    // const marketplaceToast = (placement) => {
    //     if (marketplaceSuccess) {
    //         api.success({
    //             message: "marketplaceMsg",
    //             onClose: marketplaceActions.resetMessage(marketplaceDispatch),
    //             placement,
    //             key: 1,
    //         });
    //     } else {
    //         api.error({
    //             message: "marketplaceMsg",
    //             onClose: marketplaceActions.resetMessage(marketplaceDispatch),
    //             placement,
    //             key: 2,
    //         });
    //     }
    // };

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
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={false} loading={false}>
                         {type}
                </Button>
            )
        }
    ];


    const handleSubmit = async () => {
        if(type==='Stake'){
          const isStaked = await inventoryActions.stakeInventory(inventoryDispatch)
        }

        if(type==='Unstake'){
            const isUnstaked = await inventoryActions.UnstakeInventory(inventoryDispatch) 
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
                <div> <p className="text-[#202020] font-medium text-sm">Quantity {type === 'Stake' ? 'Available' : 'to Unstake'}</p>
                    <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
                        <p> {inventory?.quantity}</p>
                    </div>
                </div>
                <div className="w-full">
                    <p className=" w-full text-[#202020] font-medium text-sm ">Liquidity</p>
                    <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center "> 
                        <div className="flex mx-auto">3000 {logo} </div> </div> 
                </div>
                <div className="w-full flex justify-center items-center">
                    <Button type="primary" className="w-32 h-9" onClick={handleSubmit}  loading={false}>
                        {type}
                    </Button>
                </div>

            </div>
            {contextHolder}
            {/* {marketplaceMsg && marketplaceToast("bottom")} */}
        </Modal>
    )
}

export default StakeModal;
