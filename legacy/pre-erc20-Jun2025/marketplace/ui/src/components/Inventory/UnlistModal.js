import { Button, Modal } from 'antd';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useAuthenticateState } from '../../contexts/authentication';
import { useLocation } from 'react-router-dom';

const UnlistModal = ({
  open,
  handleCancel,
  inventory,
  saleAddress,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  reserves,
}) => {
  const inventoryDispatch = useInventoryDispatch();
  const { isUnlisting } = useInventoryState();
  const { user } = useAuthenticateState();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const handleSubmit = async () => {
    let body = {
      saleAddress,
    };
    let isDone = await actions.unlistInventory(inventoryDispatch, body);
    if (isDone) {
      await actions.fetchInventory(
        inventoryDispatch,
        limit,
        offset,
        debouncedSearchTerm,
        category && category !== 'All' ? category : undefined,
        queryParams.get('st') === 'true' ||
          window.location.pathname === '/stake'
          ? reserves.map((reserve) => reserve.assetRootAddress)
          : ''
      );
      await actions.fetchInventoryForUser(
        inventoryDispatch,
        limit,
        offset,
        debouncedSearchTerm,
        category && category !== 'All' ? category : undefined
      );
      handleCancel();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={`Unlist - ${decodeURIComponent(inventory.name)}`}
      width={450}
      footer={[
        <Button
          id="modal-unlist-btn"
          type="primary"
          className="w-32 h-9"
          onClick={handleSubmit}
          loading={isUnlisting}
        >
          Unlist
        </Button>,
      ]}
    ></Modal>
  );
};

export default UnlistModal;
