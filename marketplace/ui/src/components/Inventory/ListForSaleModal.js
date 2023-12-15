import { Button, Input, InputNumber, Modal, Select, Tag, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { PAYMENT_TYPE } from "../../helpers/constants";

const { Option } = Select;

const ListForSaleModal = ({ open, handleCancel, inventory, paymentProviderAddress }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(inventory.quantity);
    const [paymentTypes, setPaymentTypes] = useState([]);
    const [pricePerUnit, setpricePerUnit] = useState(inventory.price ? inventory.price : inventory.pricePerUnit);
    const inventoryDispatch = useInventoryDispatch();
    const [canList, setCanList] = useState(true);
    const {
        isListing
    } = useInventoryState();

    useEffect(() => {
        const itemData = JSON.parse(inventory.data);
        if (quantity > itemData.quantity || quantity <= 0) {
            setCanList(false);
        }
        else {
            setCanList(true);
        };
    }, [quantity])

    const tagRender = (props) => {
        const { label, value, closable, onClose } = props;
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
            {PAYMENT_TYPE[value].icon ? PAYMENT_TYPE[value].icon : <></>}
            <p className="ml-1">{label}</p>
          </Tag>
        );
    };

    const handleSelectAll = (value) => {
        if (value.includes(0)) {
          if (value.length === PAYMENT_TYPE.length) {
            setPaymentTypes([]);
            return []
          }
          setPaymentTypes([1, 2, 3, 4, 5]);
          return [1, 2, 3, 4, 5];
        } else {
          setPaymentTypes(value);
          return value;
        }
    }

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
                        allowClear
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

    const handleSubmit = async () => {
        let body = {
            paymentProviders: paymentProviderAddress ? [paymentProviderAddress] : [],
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
        if (isDone) {
            actions.fetchInventory(inventoryDispatch, 10, 0, "");
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
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canList || inventory.status === "1"} loading={isListing}>
                    {inventory.saleAddress ? 'Update' : 'List' }
                </Button>
            ]}
        >
            <Table
                columns={columns()}
                dataSource={data}
                pagination={false}
            />
        </Modal>
    )
}


export default ListForSaleModal;