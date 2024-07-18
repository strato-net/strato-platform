import { Button, Modal } from "antd";
// Actions
import { actions as inventoryActions } from "../../contexts/inventory/actions";
// States
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useAuthenticateState } from "../../contexts/authentication";

const UnlistModal = ({ open, handleCancel, inventory, saleAddress, categoryName, limit, offset }) => {
    // Dispatch
    const inventoryDispatch = useInventoryDispatch();
    // States
    const { isUnlisting } = useInventoryState();
    const { user } = useAuthenticateState();

    const handleSubmit = async () => {
        let body = { saleAddress };
        let isDone = await inventoryActions.unlistInventory(inventoryDispatch, body);
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
            title={`Unlist - ${decodeURIComponent(inventory.name)}`}
            width={650}
            footer={[
                <Button id="modal-unlist-btn" type="primary" className="w-32 h-9" onClick={handleSubmit} loading={isUnlisting}>
                    Unlist
                </Button>
            ]}
        >
        </Modal>
    )
}

export default UnlistModal;
