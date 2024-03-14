import { Button, Modal } from "antd";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useAuthenticateState } from "../../contexts/authentication";

const UnlistModal = ({ open, handleCancel, inventory, saleAddress, categoryName, limit, offset }) => {
    const inventoryDispatch = useInventoryDispatch();
    const {
        isUnlisting
    } = useInventoryState();
    const { user } = useAuthenticateState();

    const handleSubmit = async () => {
        // Handles grouped and single assets
        if (inventory.groupedAssets) {
            // Iterate over each groupedAsset and unlist each one
            for (const asset of inventory.groupedAssets) {
                if (asset.saleAddress) {
                    let body = {
                        saleAddress: asset.saleAddress,
                    };
        
                    await actions.unlistInventory(inventoryDispatch, body);
                }
            }
        }
        await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
        await actions.fetchInventoryForUser(inventoryDispatch, limit, offset, user.commonName);
        handleCancel();
    };
    

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            title={`Unlist - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} loading={isUnlisting}>
                    Unlist
                </Button>
            ]}
        >
        </Modal>
    )
}


export default UnlistModal;