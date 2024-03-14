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
        let isSuccess = true;
        console.log("do we get here", inventory.groupedAssets)
        // Logic for handling grouped assets
        if (inventory.groupedAssets && inventory.groupedAssets.length > 1) {
            console.log("we shouldn't get here")
            // Iterate over each groupedAsset and unlist each one
            for (const asset of inventory.groupedAssets) {
                if (asset.saleAddress) { // Ensure the asset has a saleAddress before attempting to unlist
                    let body = {
                        saleAddress: asset.saleAddress,
                    };
    
                    let isDone = await actions.unlistInventory(inventoryDispatch, body);
                    if (!isDone) {
                        isSuccess = false; // Mark as failure if any unlist operation fails
                        break; // Optionally stop on first failure, or remove break to attempt all
                    }
                }
            }
        } else {
            console.log("i want to get here")
            let body = {
                saleAddress,
            };
            isSuccess = await actions.unlistInventory(inventoryDispatch, body);
        }
    
        // Refresh inventory and close form if the unlist operation was successful
        if (isSuccess) {
            await actions.fetchInventory(inventoryDispatch, limit, offset, "", categoryName);
            await actions.fetchInventoryForUser(inventoryDispatch, limit, offset, user.commonName);
            handleCancel();
        } 
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