import { Button, Input, InputNumber, Modal, Select, Spin, Tag, Table, Typography } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { usePaymentServiceDispatch, usePaymentServiceState } from "../../contexts/payment";
import { actions as paymentServiceActions } from "../../contexts/payment/actions";

const { Option } = Select;

const ListForSaleModal = ({ open, handleCancel, inventory, categoryName, limit, offset, user }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(inventory.saleAddress ? inventory.saleQuantity : inventory.quantity);
    const [paymentTypes, setPaymentTypes] = useState([]);
    const [availablePaymentProviders, setAvailablePaymentProviders] = useState([]);
    const [pricePerUnit, setpricePerUnit] = useState(inventory.price ? inventory.price : inventory.pricePerUnit);
    const inventoryDispatch = useInventoryDispatch();
    const [canList, setCanList] = useState(true);
    const {
        isListing,
        issaleUpdating
    } = useInventoryState();
    const {
        paymentServices,
        arePaymentServicesLoading,
        notOnboarded,
        areNotOnboardedLoading
    } = usePaymentServiceState();
    const paymentServiceDispatch = usePaymentServiceDispatch();

    useEffect(() => {
      paymentServiceActions.getPaymentServices(paymentServiceDispatch);
      paymentServiceActions.getNotOnboarded(paymentServiceDispatch, user?.commonName, 10, 0);
    }, [paymentServiceDispatch, user]);

    useEffect(() => {
        if ( inventory.saleAddress ? quantity > (inventory.quantity - inventory.totalLockedQuantity) : quantity > inventory.quantity || quantity <= 0 || pricePerUnit <= 0) {
            setCanList(false);
        }
        else {
            setCanList(true);
        };
    }, [quantity, pricePerUnit])

    useEffect(() => {
        const diff = paymentServices.filter(ps => 
          !notOnboarded.some(x => x.address === ps.address)
        );
        setAvailablePaymentProviders(diff);
      }, [paymentServices, notOnboarded]);

    const renderImg = (service) => {
        return service.imageURL && service.imageURL !== ''
            ? <img src={service.imageURL} alt={service.serviceName} height="16px" width="16px"/>
            : ''
    }

    const tagRender = (props) => {
        const { value, closable, onClose } = props;
        const service = availablePaymentProviders[value];
        const onPreventMouseDown = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        return <> { service ? (
            <Tag
                onMouseDown={onPreventMouseDown}
                closable={closable}
                onClose={onClose}
                className="flex items-center mr-1"
            >
                {service.serviceName}&nbsp;
                {renderImg(service)}
            </Tag>
        ) : '' }
        </>;
    };

    const handleSelect = (values) => {
        setPaymentTypes(values);
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
                        onChange={handleSelect}
                        showSearch={false}
                        className="w-64"
                    >
                        {!arePaymentServicesLoading ? (
                            availablePaymentProviders.map((e, index) => (
                                <Option value={index}>
                                    <div className="flex items-center mr-1">
                                        {e.serviceName}&nbsp;
                                        {renderImg(e)}
                                    </div>
                                </Option>
                            ))
                        ) : (
                          <div className="absolute left-[50%] md:top-4">
                            <Spin size="large" />
                          </div>
                        )}
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
                                <InputNumber 
                                  value={pricePerUnit}
                                  controls={false} 
                                  min={0.01} 
                                  onChange={(value) => {
                                    if (value !== null && value > 0) {
                                      setpricePerUnit(parseFloat(value.toFixed(2)));
                                    }
                                  }} 
                                />
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
                                <InputNumber 
                                  value={pricePerUnit} 
                                  controls={false} 
                                  min={0.01}
                                  onChange={(value) => {
                                    if (value !== null && value > 0) {
                                      setpricePerUnit(parseFloat(value.toFixed(2)));
                                    }
                                  }}
                                />
                            )
                        }
                    ])
                break;
            default:
                finalColumns.push({
                    title: "Set Price",
                    align: "center",
                    render: () => (
                        <InputNumber 
                          id="sellPrice" 
                          value={pricePerUnit} 
                          controls={false} 
                          min={0.01} 
                          onChange={(value) => {
                            if (value !== null && value > 0) {
                              setpricePerUnit(parseFloat(value.toFixed(2)));
                            }
                          }}
                        />
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

    const handleSubmit = async () => {
        let body = {
            paymentProviders: paymentTypes.map((p) => availablePaymentProviders[p].address),
            price: pricePerUnit,
        };
        if (inventory.saleAddress) {
            body = { ...body, saleAddress: inventory.saleAddress }
        } else {
            body = { ...body, assetToBeSold: inventory.address }
        }
        body = {
            ...body,
            quantity,
        }
        let isDone
        
        if (inventory.saleAddress) {
            isDone = await actions.updateSale(inventoryDispatch, body);
        } else {
            isDone = await actions.listInventory(inventoryDispatch, body);
        }
        if ( isDone ) {
            await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
            handleCancel();
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`${inventory.saleAddress ? 'Update' : 'List'} - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <div className="flex justify-center md:block">   
                  <Button id="asset-update-list" type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canList} loading={inventory.saleAddress ? issaleUpdating : isListing}>
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
                        onChange={handleSelect}
                        showSearch={false}
                        className="w-full"
                    >
                        {availablePaymentProviders.map((e, index) => (
                            <Option value={index}>
                                <div className="flex items-center mr-1">
                                    {e.serviceName}&nbsp;
                                    {renderImg(e)}
                                </div>
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