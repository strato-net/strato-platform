import { Button, Input, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import dayjs from 'dayjs';


const RetireModal = ({ open, handleCancel, inventory }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
    const [retiredOnBehalfOf, setRetiredOnBehalfOf] = useState("");
    const [purpose, setPurpose] = useState("");
    const inventoryDispatch = useInventoryDispatch();
    const [canRetire, setCanRetire] = useState(true);
    const {
        isRetiringCredits
    } = useInventoryState();

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
            inventoryId: inventory.address,
            retiredBy: inventory.name,
            retiredOnBehalfOf: retiredOnBehalfOf,
            quantity: quantity,
            purpose: purpose
        };
        if (quantity > 0 && quantity <= inventory.availableQuantity && inventory.vintage <= dayjs().year()) {
            let isDone = await actions.resellInventory(inventoryDispatch, body);
            if (isDone) 
            {
                actions.fetchInventory(inventoryDispatch, 10, 0, "");
                handleCancel();
            }
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Retire - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canRetire} loading={isRetiringCredits}>
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