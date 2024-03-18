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
        if (inventory.groupedAssets) {
            let body = {
                saleAddresses: inventory.groupedAssets.filter(asset => asset.saleAddress).map(asset => asset.saleAddress),
            };
    
            if (body.saleAddresses.length > 0) {
                await actions.unlistInventory(inventoryDispatch, body);
            }
        }
        // Refresh inventory after unlisting
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