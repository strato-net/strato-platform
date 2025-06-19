import { Button, Input, InputNumber, Modal, Table } from 'antd';
import { useEffect, useState } from 'react';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useAuthenticateState } from '../../contexts/authentication';
import { useLocation } from 'react-router-dom';

const BridgeModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  reserves,
}) => {
  const [data, setData] = useState([inventory]);
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const [quantity, setQuantity] = useState(1);
  const [userAddress, setUserAddress] = useState('');
  const inventoryDispatch = useInventoryDispatch();
  const [canTransfer, setCanTransfer] = useState(true);
  const { user } = useAuthenticateState();
  const { isBridging } = useInventoryState();

  useEffect(() => {
    if (quantity > inventory.quantity || quantity <= 0 || !userAddress) {
      setCanTransfer(false);
    } else {
      setCanTransfer(true);
    }
  }, [quantity, userAddress]);

  const columns = [
    {
      title: 'Quantity Available',
      dataIndex: 'quantity',
      align: 'center',
    },
    {
      title: 'Set Quantity',
      align: 'center',
      render: () => (
        <InputNumber
          value={quantity}
          controls={false}
          min={1}
          max={inventory.quantity}
          onChange={(value) => setQuantity(value)}
          precision={0}
        />
      ),
    },
    {
      title: 'Base Wallet Address',
      align: 'center',
      render: () => (
        <Input
          placeholder="Base Chain address"
          value={userAddress}
          onChange={(e) => setUserAddress(e.target.value)}
        />
      ),
    },
  ];

  const handleSubmit = async () => {
    const body = {
      rootAddress: inventory.root,
      assetAddress: inventory.address,
      quantity,
      price: 1,
      baseAddress: userAddress,
      mercataAddress: inventory.owner,
    };

    if (quantity > 0 && quantity <= inventory.quantity && userAddress) {
      let isDone = await actions.bridgeInventory(inventoryDispatch, body);
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
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={`Bridge - ${decodeURIComponent(inventory.name)} to Base Chain`}
      width={1000}
      footer={[
        <div className="flex justify-center md:block">
          <Button
            type="primary"
            className="w-32 h-9"
            onClick={handleSubmit}
            disabled={!canTransfer}
            loading={isBridging}
          >
            Bridge
          </Button>
        </div>,
      ]}
    >
      <div className="head hidden md:block">
        <Table columns={columns} dataSource={data} pagination={false} />
      </div>
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          {' '}
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p> {inventory?.quantity}</p>
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={quantity}
              controls={false}
              min={1}
              max={inventory.quantity}
              onChange={(value) => setQuantity(value)}
              precision={0}
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">
            Base Wallet Address
          </p>
          <Input
            placeholder="Base Chain address"
            value={userAddress}
            onChange={(e) => setUserAddress(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};

export default BridgeModal;
