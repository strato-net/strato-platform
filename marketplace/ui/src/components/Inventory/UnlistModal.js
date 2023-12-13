import { Button, Modal } from "antd";
import { actions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";

const UnlistModal = ({ open, handleCancel, inventory, saleAddress }) => {
    const inventoryDispatch = useInventoryDispatch();
    const {
        isUnlisting
    } = useInventoryState();

    const handleSubmit = async () => {
        let body = {
            saleAddress
        };
        let isDone = await actions.unlistInventory(inventoryDispatch, body);
        if (isDone) {
            actions.fetchInventory(inventoryDispatch, 10, 0, "");
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
                <Button type="primary" className="w-32 h-9" onClick={handleSubmit} loading={isUnlisting}>
                    Unlist
                </Button>
            ]}
        >
        </Modal>
    )
}


export default UnlistModal;