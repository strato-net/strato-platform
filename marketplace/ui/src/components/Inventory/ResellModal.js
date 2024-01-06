import { Button, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as itemActions } from "../../contexts/item/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useItemDispatch } from "../../contexts/item";

const ResellModal = ({ open, handleCancel, inventory, categoryName }) => {
    const [quantity, setQuantity] = useState(1);
    const inventoryDispatch = useInventoryDispatch();
    const itemDispatch = useItemDispatch();
    const [canResell, setCanResell] = useState(true);
    const {
        isReselling
    } = useInventoryState();

    useEffect(() => {
        itemActions.fetchItem(itemDispatch, "", 0, inventory.address);
    }, [])

    useEffect(() => {
        if (quantity <= 0) {
            setCanResell(false);
        }
        else {
            setCanResell(true);
        };
    }, [quantity])

    const columns = () => {
        return [
            {
                title: "Units",
                align: "center",
                render: () => (
                    <InputNumber value={quantity} controls={false} min={1} onChange={(value) => setQuantity(value)} />
                )
            },
        ]
    };

    const handleSubmit = async () => {
        let body = {
            assetAddress: inventory.address,
            quantity
        };
        let isDone = await actions.resellInventory(inventoryDispatch, body);
        if (isDone) {
            await actions.fetchInventory(inventoryDispatch, 10, 0, "", categoryName);
            handleCancel();
        }
    }

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Mint - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canResell || inventory.status === "1"} loading={isReselling}>
                    Mint
                </Button>
            ]}
        >
            <div className="head">

            <Table
            
                columns={columns()}
                dataSource={[inventory]}
                pagination={false}
            />
            </div>
        </Modal>
    )
}


export default ResellModal;