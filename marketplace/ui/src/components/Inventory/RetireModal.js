import { Button, Input, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import dayjs from 'dayjs';


const RetireModal = ({ open, handleCancel, inventory }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [retiredOnBehalfOf, setRetiredOnBehalfOf] = useState("");
    const [purpose, setPurpose] = useState("");
    const itemsDispatch = useItemDispatch();
    const [canRetire, setCanRetire] = useState(true);
    const {
        isRetiringItem
    } = useItemState();

    useEffect(() => {
        if (quantity > inventory.availableQuantity) {
            setCanRetire(false);
        }
        else {
            setCanRetire(true);
        };
        if (inventory.vintage > dayjs().year()) {
            setCanRetire(false);
        }
    }, [quantity])
    const columns = [
        {
            title: "Vintage",
            dataIndex: "vintage"
        },
        {
            title: "Quantity Available",
            dataIndex: "availableQuantity"
        },
        {
            title: "Set Quantity",
            render: () => (
                <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
            )
        },
        {
            title: "Retired on Behalf of",
            render: () => (
                <Input value={retiredOnBehalfOf} onChange={(e) => setRetiredOnBehalfOf(e.target.value)} />
            )
        },
        {
            title: "Retirement Purpose",
            render: () => (
                <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            )
        }
    ];

    const handleSubmit = async () => {
        const body = {
            productId: inventory.productId,
            inventoryId: inventory.address,
            retiredBy: inventory.name,
            retiredOnBehalfOf: retiredOnBehalfOf,
            quantity: quantity,
            purpose: purpose
        };
        if (quantity > 0 && quantity <= inventory.availableQuantity && inventory.vintage <= dayjs().year()) {
            await actions.retireItem(itemsDispatch, body);
            handleCancel();
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Retire - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canRetire} loading={isRetiringItem}>
                    Retire
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


export default RetireModal;