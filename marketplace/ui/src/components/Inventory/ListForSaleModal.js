import { Button, Input, InputNumber, Modal, Select, Tag, Table, Typography } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { PAYMENT_TYPE } from "../../helpers/constants";

const { Option } = Select;

const ListForSaleModal = ({ open, handleCancel, inventory, paymentProviderAddress, categoryName, limit, offset }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(inventory.saleAddress ? inventory.saleQuantity : inventory.quantity);
    const [paymentTypes, setPaymentTypes] = useState([PAYMENT_TYPE[0].value]);
    const [pricePerUnit, setpricePerUnit] = useState(inventory.price ? inventory.price : inventory.pricePerUnit);
    const inventoryDispatch = useInventoryDispatch();
    const [canList, setCanList] = useState(true);
    const {
        isListing,
        issaleUpdating
    } = useInventoryState();

    useEffect(() => {
        if ( inventory.saleAddress ? quantity > (inventory.quantity - inventory.totalLockedQuantity) : quantity > inventory.quantity || quantity <= 0 || pricePerUnit <= 0) {
            setCanList(false);
        }
        else {
            setCanList(true);
        };
    }, [quantity, pricePerUnit])

    const tagRender = (props) => {
        const { value, closable, onClose } = props;
        const onPreventMouseDown = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        return (
            <Tag
                onMouseDown={onPreventMouseDown}
                closable={closable}
                onClose={onClose}
                className="flex items-center mr-1"
            >
                {PAYMENT_TYPE[0].name}
                {/* {renderIcon(value)} */}
                {/* (...) Indicates More options in addition to available icons */}
                {/* <p className="ml-1">...</p> */}
            </Tag>
        );
    };
    const renderIcon = (value) => {
        const paymentType = PAYMENT_TYPE.find(type => type.value === value);

        if (paymentType) {
            if (paymentType.name === "Credit Card / ACH") {
                return paymentType.options.map((IconComponent, index) => (
                    <span key={index} className="ml-1">{IconComponent}</span>
                ));
            } else {
                return paymentType.icon ? paymentType.icon : <></>;
            }
        }
    };

    const handleSelectAll = () => {
        const allValues = PAYMENT_TYPE.filter(type => type.value !== 0).map(type => type.value);
        setPaymentTypes(allValues);
        return allValues;
    };

    const columns = () => {
        let finalColumns = [
            {
                title: "Set Payment Types",
                align: "center",
                render: () => (
                    <Select
                        id="paymentTypes"
                        mode="multiple"
                        tagRender={tagRender}
                        placeholder="Select Payment Types"
                        name="paymentTypes"
                        maxTagCount="responsive"
                        value={paymentTypes}
                        onChange={handleSelectAll}
                        showSearch={false}
                        className="w-64"
                    >
                        {PAYMENT_TYPE.map((e, index) => (
                            <Option value={e.value} key={index}>
                                {e.name}
                            </Option>
                        ))}
                    </Select>
                )
            },
            {
                title: "Quantity",
                align: "center",
                render: () => (
                    <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
                )
            },
        ]
        switch (getCategory()) {
            case 'CarbonOffset':
                finalColumns = finalColumns.concat(
                    [
                        {
                            title: "Set Price Per Unit",
                            align: "center",
                            render: () => (
                                <InputNumber value={pricePerUnit} controls={false} min={1} onChange={(value) => setpricePerUnit(value)} />
                            )
                        }
                    ])
                break;
            case 'Metals':
                finalColumns = finalColumns.concat(
                    [
                        {
                            title: "Set Price Per Unit",
                            align: "center",
                            render: () => (
                                <InputNumber value={pricePerUnit} controls={false} min={1} onChange={(value) => setpricePerUnit(value)} />
                            )
                        }
                    ])
                break;
            default:
                finalColumns.push({
                    title: "Set Price",
                    align: "center",
                    render: () => (
                        <InputNumber value={pricePerUnit} controls={false} min={1} onChange={(value) => setpricePerUnit(value)} />
                    )
                })
                break;
        }

        return finalColumns;
    };




    const getCategory = () => {
        const parts = inventory.contract_name.split('-');
        return parts[parts.length - 1];
    };

    async function handleSubmit() {
        let totalQuantityToBeListed = quantity;
        let quantityAllocated = 0;
    
        // Filter assets that have a saleAddress
        let assetsToUpdate = inventory.groupedAssets.filter(asset => asset.saleAddress);
    
        // Calculate quantity from assets with a saleAddress
        quantityAllocated = assetsToUpdate.reduce((sum, asset) => sum + asset.quantity, 0);
        let isIncrease = totalQuantityToBeListed > quantityAllocated;
        let promises = [];

        // If there are assets with saleAddress, prepare update and potential listing
        if (assetsToUpdate.length > 0) {
            let updateBody = {
                paymentProviders: paymentProviderAddress ? [paymentProviderAddress] : [],
                price: pricePerUnit,
                quantity: totalQuantityToBeListed,
                isIncrease: isIncrease,
                assets: assetsToUpdate.map(asset => ({
                    saleAddress: asset.saleAddress,
                    saleQuantity: asset.quantity,
                })),
            };
    
            // Store the promise for updating sales
            promises.push(actions.updateSale(inventoryDispatch, updateBody));
        }
    
        // Calculate remaining quantity to be listed
        let remainingQuantity = totalQuantityToBeListed - quantityAllocated;
    
        // If we still have more we need to list of if there are no saleAddresses we can call the listInventory function
        if (remainingQuantity > 0 || assetsToUpdate.length === 0) {
            let assetsToList = inventory.groupedAssets.reduce((acc, asset) => {
                if (quantityAllocated < totalQuantityToBeListed && (!asset.saleAddress || assetsToUpdate.length === 0)) {
                    let quantityForThisAsset = Math.min(asset.quantity, totalQuantityToBeListed - quantityAllocated);
                    quantityAllocated += quantityForThisAsset;
    
                    if (quantityForThisAsset > 0) {
                        acc.push({
                            assetToBeSold: asset.address,
                            quantity: quantityForThisAsset,
                        });
                    }
                }
                return acc;
            }, []);
    
            if (assetsToList.length > 0) {
                let listBody = {
                    paymentProviders: paymentProviderAddress ? [paymentProviderAddress] : [],
                    price: pricePerUnit,
                    assets: assetsToList,
                };
    
                // Store the promise for listing inventory
                promises.push(actions.listInventory(inventoryDispatch, listBody));
            }
        }
    
        // Wait for all promises to complete before fetching inventory
        Promise.all(promises).then(results => {
            if (results.some(result => result === true)) {
                actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName).then(() => {
                    handleCancel();
                }, error => {
                    console.error("Failed to fetch inventory:", error);
                });
            } else {
                handleCancel();
            }
        });
    }
    
    
    
    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`${inventory.saleAddress ? 'Update' : 'List'} - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <div className="flex justify-center md:block">   
                  <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canList || inventory.status === "1"} loading={inventory.saleAddress ? issaleUpdating : isListing}>
                      {inventory.saleAddress ? 'Update' : 'List' }
                  </Button>
                </div>
            ]}
        >
            <div className="head hidden md:block">
                <Table
                    columns={columns()}
                    dataSource={data}
                    pagination={false}
                />
            </div>
            <div className="flex gap-5 flex-col justify-center md:hidden mt-5">
                <div className="w-full">
                    <Typography className="text-[#202020] text-sm font-medium">Set Payment Types</Typography>
                    <Select

                        id="paymentTypes"
                        mode="multiple"
                        tagRender={tagRender}
                        placeholder="Select Payment Types"
                        name="paymentTypes"
                        maxTagCount="responsive"
                        value={paymentTypes}
                        onChange={handleSelectAll}
                        showSearch={false}
                        className="w-full"
                    >
                        {PAYMENT_TYPE.map((e, index) => (
                            <Option value={e.value} key={index}>
                                {e.name}
                            </Option>
                        ))}
                    </Select>
                </div>
                <div className="w-full">
                    <Typography className="text-[#202020] text-sm font-medium">Quantity</Typography>
                    <InputNumber className="w-full h-9" value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
                </div>
                <div>
                    <Typography className="text-[#202020] text-sm font-medium">{getCategory() === "CarbonOffset" || getCategory() === "Metals" ? "Set Price Per Unit" : "Set Price"}</Typography>
                    <InputNumber className="w-full h-9" value={pricePerUnit} controls={false} min={1} onChange={(value) => setpricePerUnit(value)} />
                </div>

            </div>
        </Modal>
    )
}


export default ListForSaleModal;