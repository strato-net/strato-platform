import { Button, Input, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as itemActions } from "../../contexts/item/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useItemDispatch, useItemState } from "../../contexts/item";


const ResellModal = ({ open, handleCancel, inventory }) => {
    const [data, setData] = useState([inventory]);
    const [quantity, setQuantity] = useState(1);
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
        if (quantity > inventory.availableQuantity || quantity <= 0) {
            setCanResell(false);
        }
        else {
            setCanResell(true);
        };
    }, [quantity])
    const columns = [
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
            title: "Set Price",
            render: () => (
                <InputNumber value={pricePerUnit} controls={false} min={1} onChange={(value) => setpricePerUnit(value)} />
            )
        }
    ];


    const handleSubmit = async () => {
        const itemsAddress = items.map((item) => item.address)

        const body = {
            inventoryId: inventory.address,
            quantity: quantity,
            price: pricePerUnit,
            itemsAddress: itemsAddress
        };
        if (quantity > 0 && quantity <= inventory.availableQuantity) {
            let isDone = await actions.resellInventory(inventoryDispatch, body);
            if (isDone) {
                actions.fetchInventory(inventoryDispatch, 10, 0, "");
                handleCancel();
            }
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Resell - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canResell} loading={isReselling}>
                    Resell
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


export default ResellModal;