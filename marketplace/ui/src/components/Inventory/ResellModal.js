import { Button, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useAuthenticateState } from "../../contexts/authentication";

const ResellModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    const [quantity, setQuantity] = useState(1);
    const inventoryDispatch = useInventoryDispatch();
    const [canResell, setCanResell] = useState(true);
    const {
        isReselling
    } = useInventoryState();
    const { user } = useAuthenticateState();

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
            quantity: inventory.data.quantityIsDecimal && inventory.data.quantityIsDecimal === "True" ? quantity * 100 : quantity,
        };
        let isDone = await actions.resellInventory(inventoryDispatch, body);
        if (isDone) {
            await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
            await actions.fetchInventoryForUser(inventoryDispatch, 10000, 0, "", undefined);
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
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} disabled={!canResell} loading={isReselling}>
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