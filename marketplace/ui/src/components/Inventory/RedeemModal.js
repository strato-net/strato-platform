import { Button, InputNumber, Modal, Table, Input, Spin } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch } from "../../contexts/inventory";
import { actions as redemptionActions } from "../../contexts/redemption/actions";
import { useRedemptionDispatch, useRedemptionState } from "../../contexts/redemption";
import { useAuthenticateState } from "../../contexts/authentication";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { MinusCircleOutlined } from '@ant-design/icons';
import AddressComponent from "../MarketPlace/AddressComponent";
import AddAddressModal from "../MarketPlace/AddAddressModal";
import { Images } from "../../images";

const RedeemModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [comments, setComments] = useState("");
    const inventoryDispatch = useInventoryDispatch();
    const redemptionDispatch = useRedemptionDispatch();
    const marketplaceDispatch = useMarketplaceDispatch();
    const [canRedeem, setCanRedeem] = useState(true);
    const [selectedAddress, setSelectedAddress] = useState(0);
    const [modalAddress, setmodalAddress] = useState(false);
    const [showAddress, setshowAddress] = useState(false);
    const { user } = useAuthenticateState();
    const { isRequestingRedemption } = useRedemptionState();
    const { userAddresses, isLoadingUserAddresses } = useMarketplaceState();
    const { TextArea } = Input;

    const closeAddressModel = () => {
        setmodalAddress(false);
        setshowAddress(false);
    }

    useEffect(() => {
        marketplaceActions.fetchUserAddresses(marketplaceDispatch);
    }, [marketplaceDispatch])

    useEffect(() => {
        if (quantity > inventory.quantity || quantity <= 0) {
            setCanRedeem(false);
        }
        else {
            setCanRedeem(true);
        };
    }, [quantity])

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
            title: "Additional comments",
            align: "center",
            render: () => (
                <TextArea value={comments} onChange={(e) => setComments(e.target.value)} />
            )
        }
    ];

    const handleSubmit = async () => {
        const body = {
            assetAddresses: [inventory.address],
            originAssetAddress: inventory.originAddress,
            quantity: quantity,
            shippingAddressId: userAddresses[selectedAddress].address_id,
            ownerCommonName: user.commonName,
            ownerComments: comments
        };

        if (quantity > 0 && quantity <= inventory.quantity) {
            let isDone = await redemptionActions.requestRedemption(redemptionDispatch, body);
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
            title={`Redeem - ${decodeURIComponent(inventory.name)}`}
            width={1200}
            centered
            footer={[
                <div className="flex justify-center md:block">
                    <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canRedeem} loading={isRequestingRedemption}>
                        Redeem
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
                <div className="flex gap-4 mt-4">
                    <p className="text-base md:text-xl lg:text-2xl text-[#202020] font-semibold ">Address Details</p>
                    {showAddress ?
                        <MinusCircleOutlined className="text-xl text-primary"
                            onClick={() => {
                                setshowAddress(false);
                            }}
                        />
                        :
                        <>
                            <div className="hidden md:block"><Button type="link" icon={<img src={Images.AddBlack} className=" w-4 h-4 lg:w-6 lg:h-6 " alt="add" />}
                                onClick={() => {
                                    setshowAddress(true);
                                    setmodalAddress(true);
                                }}
                            /></div>
                            {/* <div className="  md:hidden"><Button type="link" icon={<img src={Images.AddBlack} className=" w-4 h-4 lg:w-6 lg:h-6 " alt="add" />}
                            onClick={() => {
                                setResponsiveAddress(true);
                            }}
                        /></div> */}
                        </>
                    }
                </div>
                {modalAddress && <AddAddressModal open={modalAddress} close={closeAddressModel} />}
                {isLoadingUserAddresses ?
                    <div className="h-80 flex justify-center items-center">
                        <Spin spinning={isLoadingUserAddresses} size="large" />
                    </div>
                    :
                    userAddresses.length !== 0 ?
                        <div className="grid grid-rows-2 sm:grid-rows-1 grid-flow-col gap-4 lg:flex  lg:flex-wrap overflow-x-auto lg:overflow-y-auto hide-Scroll lg:gap-x-6 lg:gap-y-[20px] pt-4 h-[50%] lg:h-[44vh]">
                            {
                                userAddresses.map((add, index) =>
                                    <div key={index}>
                                        <div className={`w-[307px] h-[200px] overflow-x-auto hide-Scroll py-3 px-[14px] rounded-[4px] ${index !== selectedAddress ? " cursor-pointer border border-[#0000002E] " : " border border-primary cursor-pointer"}`} onClick={() => { setSelectedAddress(index) }}>
                                            <AddressComponent userAddress={add} />
                                        </div>
                                    </div>
                                )
                            }
                        </div>
                        :
                        <div className="flex justify-center items-center h-48 ">
                            <p className="text-2xl font-semibold text-[#202020]">
                                Please Add Address
                            </p>
                        </div>
                }
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
            </div>
        </Modal>
    )
}


export default RedeemModal;