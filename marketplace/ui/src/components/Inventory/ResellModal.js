import { Button, InputNumber, Modal, Table } from 'antd';
import { useEffect, useState } from 'react';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useAuthenticateState } from '../../contexts/authentication';
import { useLocation } from 'react-router-dom';
import BigNumber from 'bignumber.js';

const ResellModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  reserves,
  assetsWithEighteenDecimalPlaces,
}) => {
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(inventory.originAddress);
  const [quantity, setQuantity] = useState(1);
  const inventoryDispatch = useInventoryDispatch();
  const [canResell, setCanResell] = useState(true);
  const { isReselling } = useInventoryState();
  const { user } = useAuthenticateState();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  useEffect(() => {
    if (quantity <= 0) {
      setCanResell(false);
    } else {
      setCanResell(true);
    }
  }, [quantity]);

  const columns = () => {
    return [
      {
        title: 'Units',
        align: 'center',
        render: () => (
          <InputNumber
            value={quantity}
            controls={false}
            min={1}
            onChange={(value) => setQuantity(value)}
            precision={0}
          />
        ),
      },
    ];
  };

  const handleSubmit = async () => {
    const body = {
      assetAddress: inventory.address,
      quantity: new BigNumber(quantity)
        .multipliedBy(is18DecimalPlaces ? 10 ** 18 : 1)
        .toFixed(0),
    };
    let isDone = await actions.resellInventory(inventoryDispatch, body);
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
      title={`Mint - ${decodeURIComponent(inventory.name)}`}
      width={650}
      footer={[
        <Button
          type="primary"
          className="w-32 h-9"
          onClick={handleSubmit}
          disabled={!canResell}
          loading={isReselling}
        >
          Mint
        </Button>,
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
  );
};

export default ResellModal;
