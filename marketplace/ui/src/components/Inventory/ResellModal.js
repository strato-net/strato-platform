import { useEffect, useState } from "react";
import { Button, InputNumber, Modal, Table } from "antd";
// Actions
import { actions as inventoryActions } from "../../contexts/inventory/actions";
//  Dispatch and States
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useAuthenticateState } from "../../contexts/authentication";

const ResellModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    // States
    const { isReselling } = useInventoryState();
    const { user } = useAuthenticateState();
    // useStates    
    const [quantity, setQuantity] = useState(1);
    const inventoryDispatch = useInventoryDispatch();
    const [canResell, setCanResell] = useState(true);

    useEffect(() => {
        const isResell = (quantity <= 0) ? false : true;
        setCanResell(isResell);
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
        let isDone = await inventoryActions.resellInventory(inventoryDispatch, body);
        if (isDone) {
            await inventoryActions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
            await inventoryActions.fetchInventoryForUser(inventoryDispatch, user.commonName);
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
