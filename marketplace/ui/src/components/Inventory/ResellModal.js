import { Button, Input, InputNumber, Modal, Select, Tag, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as itemActions } from "../../contexts/item/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { PAYMENT_TYPE } from "../../helpers/constants";

const { Option } = Select;

const ResellModal = ({ open, handleCancel, inventory }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [paymentTypes, setPaymentTypes] = useState([]);
    const [pricePerUnit, setpricePerUnit] = useState(inventory.pricePerUnit);
    const inventoryDispatch = useInventoryDispatch();
    const itemDispatch = useItemDispatch();
    const [canResell, setCanResell] = useState(true);
    const {
        isReselling
    } = useInventoryState();
    const {
        items
    } = useItemState();

    useEffect(() => {
        itemActions.fetchItem(itemDispatch, "", 0, inventory.address);
    }, [])

    useEffect(() => {
        const itemData = JSON.parse(inventory.data);
        if (quantity > itemData.units || quantity <= 0) {
            setCanResell(false);
        }
        else {
            setCanResell(true);
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
          setPaymentTypes([1, 2, 3]);
          return [1,2,3];
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
            }]
        switch (getCategory()) {
            case 'Carbon':
                finalColumns = finalColumns.concat(
                    [
                        {
                            title: "Units",
                            align: "center",
                            render: () => (
                                <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
                            )
                        },
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
            itemContract: getCategory(),
            itemAddress: inventory.address,
            paymentTypes: paymentTypes,
            price: pricePerUnit,
        };
        if (getCategory() === "Carbon") {
            body = {
                ...body,
                units: quantity,
            }
        }
        let isDone = await actions.resellInventory(inventoryDispatch, body);
        if (isDone) {
            actions.fetchInventory(inventoryDispatch, 10, 0, "");
            handleCancel();
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Resell - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canResell || inventory.status === "1"} loading={isReselling}>
                    Resell
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


export default ResellModal;