import { Button, Input, InputNumber, Modal, Select, Spin, Tag, Table, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { usePaymentServiceDispatch, usePaymentServiceState } from "../../contexts/payment";
import { actions as paymentServiceActions } from "../../contexts/payment/actions";
import { handlePriceInput, handleQuantityInput } from "../../helpers/utils";

const { Option } = Select;

const ListForSaleModal = ({ open, handleCancel, inventory, categoryName, limit, offset, user }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(() => {
      const selectedQuantity = inventory.saleAddress
        ? inventory.saleQuantity
        : inventory.quantity;

      return selectedQuantity !== undefined
        ? inventory.data.quantityIsDecimal &&
          inventory.data.quantityIsDecimal === "True"
          ? Math.floor(selectedQuantity / 100)
          : selectedQuantity
        : undefined;
    });
    const [paymentTypes, setPaymentTypes] = useState([]);
    const [availablePaymentServices, setAvailablePaymentServices] = useState([]);
    const [pricePerUnit, setpricePerUnit] = useState(() => {
        const selectedPrice = inventory.price ? inventory.price : inventory.pricePerUnit;
      
        return selectedPrice !== undefined && inventory.data.quantityIsDecimal === "True"
          ? selectedPrice * 100
          : selectedPrice;
      });
      
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
    const inputPriceDesktopRef = useRef(null);
    const inputPriceMobileRef = useRef(null);
    const inputQuantityDesktopRef = useRef(null);
    const inputQuantityMobileRef = useRef(null);

    useEffect(() => {
        paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
        paymentServiceActions.getNotOnboarded(paymentServiceDispatch, user?.commonName, 10, 0);
    }, [paymentServiceDispatch, user]);

    useEffect(() => {
        if (inventory.saleAddress ? quantity > (inventory.quantity - inventory.totalLockedQuantity) : quantity > inventory.quantity) {
            setCanList(false);
        }
        else if (quantity < 1 || pricePerUnit < 0.01 || !pricePerUnit || paymentTypes.length < 1 || (paymentTypes.length == 1 && paymentTypes[0] === -1)) {
            setCanList(false);
        }
        else {
            setCanList(true);
        };
    }, [quantity, pricePerUnit, paymentTypes])

    useEffect(() => {
        const excludeStrats = inventory.contract_name && inventory.contract_name.toLowerCase().includes('strats');
        
        const diff = paymentServices.filter(ps => {
            const isNotOnboarded = !notOnboarded.some(x => x.address === ps.address);
            const isStratsService = excludeStrats && ps.serviceName.toLowerCase().includes('strats');
            return isNotOnboarded && !isStratsService;
        });
        setAvailablePaymentServices(diff);


        const inventoryPaymentServices = inventory.paymentServices
            ? inventory.paymentServices.filter(provider => provider.value).map(provider => provider.value)
            : [];
        const selectedPaymentServiceIndices = inventoryPaymentServices.map(inventoryPS =>
            diff.findIndex(ps => ps.creator === inventoryPS.creator && ps.serviceName === inventoryPS.serviceName)
        );
        setPaymentTypes(selectedPaymentServiceIndices);

    }, [paymentServices, notOnboarded, inventory.paymentServices]);

    useEffect(() => {
        const priceInputElements = [inputPriceDesktopRef.current, inputPriceMobileRef.current];
        const quantityInputElements = [inputQuantityDesktopRef.current, inputQuantityMobileRef.current];
        
        priceInputElements.forEach(inputElement => {
            if (inputElement) {
                inputElement.addEventListener('input', handlePriceInput(setpricePerUnit));
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
                    inputElement.removeEventListener('input', handlePriceInput(setpricePerUnit));
                }
            });

            quantityInputElements.forEach(inputElement => {
                if (inputElement) {
                    inputElement.removeEventListener('input', handleQuantityInput(setQuantity));
                }
            });
        };
    }, [inputPriceDesktopRef, inputPriceMobileRef, inputQuantityDesktopRef, inputQuantityMobileRef]);

    const renderImg = (service) => {
        return service.imageURL && service.imageURL !== ''
            ? <img src={service.imageURL} alt={service.serviceName} height="16px" width="16px" />
            : ''
    }

    const tagRender = (props) => {
        const { value, closable, onClose } = props;
        const service = availablePaymentServices[value];
        const onPreventMouseDown = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        return <> {service ? (
            <Tag
                onMouseDown={onPreventMouseDown}
                closable={closable}
                onClose={onClose}
                className="flex items-center mr-1"
            >
                {service.serviceName}&nbsp;
                {renderImg(service)}
            </Tag>
        ) : ''}
        </>;
    };

    const handleSelect = (values) => {
        setPaymentTypes(values);
    };

    const columns = () => {
        let finalColumns = [
            {
                title: "Payment Type (s)",
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
                            availablePaymentServices.map((e, index) => (
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
                    <InputNumber
                        value={quantity}
                        ref={inputQuantityDesktopRef}
                        controls={false}
                        min={1}
                        onChange={(value) => {
                            if (value) {
                                setQuantity(parseInt(value, 10));
                            }
                        }}
                    />
                )
            },
            {
                title: "Unit Price ($)",
                align: "center",
                render: () => (
                    <InputNumber
                        ref={inputPriceDesktopRef}
                        value={pricePerUnit}
                        controls={false}
                        min={0.01}
                        onChange={(value) => {
                            const stringValue = value ? value.toString() : '';
                            if (/^\d+(\.\d{0,2})?$/.test(stringValue)) {
                                setpricePerUnit(value);
                            }
                        }}
                    />
                )
            }
        ];

        return finalColumns;
    };

    const handleSubmit = async () => {
        let body = {
            paymentServices: paymentTypes
            .filter((p) => availablePaymentServices[p])
            .map((p) => {
              return {
                creator: availablePaymentServices[p].creator,
                serviceName: availablePaymentServices[p].serviceName,
              };
            }),
          price: inventory.data.quantityIsDecimal && inventory.data.quantityIsDecimal === "True" ? pricePerUnit / 100 : pricePerUnit,
        };
        if (inventory.saleAddress) {
            body = { ...body, saleAddress: inventory.saleAddress }
        } else {
            body = { ...body, assetToBeSold: inventory.address }
        }
        body = {
            ...body,
            quantity: inventory.data.quantityIsDecimal && inventory.data.quantityIsDecimal === "True" ? quantity * 100 : quantity,
        }
        let isDone

        if (inventory.saleAddress) {
            isDone = await actions.updateSale(inventoryDispatch, body);
        } else {
            isDone = await actions.listInventory(inventoryDispatch, body);
        }
        if (isDone) {
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
                        {inventory.saleAddress ? 'Update' : 'List'}
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
                    <Typography className="text-[#202020] text-sm font-medium">Payment Type (s)</Typography>
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
                        {availablePaymentServices.map((e, index) => (
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
                    <InputNumber
                        className="w-full h-9"
                        value={quantity}
                        ref={inputQuantityMobileRef}
                        controls={false}
                        min={1}
                        onChange={(value) => {
                            if (value) {
                                setQuantity(parseInt(value, 10));
                            }
                        }}
                    />
                </div>
                <div>
                    <Typography className="text-[#202020] text-sm font-medium">Unit Price ($)</Typography>
                    <InputNumber
                        className="w-full h-9"
                        value={pricePerUnit}
                        ref={inputPriceMobileRef}
                        controls={false}
                        min={.01}
                        onChange={(value) => {
                            const stringValue = value ? value.toString() : '';
                            if (/^\d+(\.\d{0,2})?$/.test(stringValue)) {
                                setpricePerUnit(value);
                            }
                        }}
                    />
                </div >

            </div >
        </Modal >
    )
}


export default ListForSaleModal;