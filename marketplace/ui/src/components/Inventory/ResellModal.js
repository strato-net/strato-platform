import { Button, InputNumber, Modal, Table } from "antd";
import { useEffect, useState } from "react";
import { actions } from "../../contexts/inventory/actions";
import { actions as itemActions } from "../../contexts/item/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useItemDispatch } from "../../contexts/item";
import { useAuthenticateState } from "../../contexts/authentication";

const ResellModal = ({ open, handleCancel, inventory, categoryName, limit, offset }) => {
    const [quantity, setQuantity] = useState(1);
    const inventoryDispatch = useInventoryDispatch();
    const itemDispatch = useItemDispatch();
    const [canResell, setCanResell] = useState(true);
    const {
        isReselling
    } = useInventoryState();
    const { user } = useAuthenticateState();

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
        let requestBody = {
            assets: [], // This will hold the resell information for each asset
        };
        let totalListedQuantity = 0; // to track the total quantity resold so far
        if (inventory.groupedAssets && inventory.groupedAssets.length > 0) {
            for (const asset of inventory.groupedAssets) {
                const remainingQuantity = quantity - totalListedQuantity;
                const availableQuantity = asset.quantity - (asset.saleQuantity + asset.totalLockedQuantity);
                const quantityToSell = Math.min(remainingQuantity, availableQuantity);
    
                if (quantityToSell > 0) {
                    requestBody.assets.push({
                        assetAddress: asset.address,
                        quantity: quantityToSell,
                    });
                    totalListedQuantity += quantityToSell;
                    // Break if we've reached or exceeded the desired total quantity
                    if (totalListedQuantity >= quantity) break;
                }
            }
            let isDone = await actions.resellInventory(inventoryDispatch, requestBody);
            if (isDone) {
                await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
                await actions.fetchInventoryForUser(inventoryDispatch, limit, offset, user.commonName);
                handleCancel();
            }
        } else {
            console.log("Grouped assets data is missing.");
        }
    };
    
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