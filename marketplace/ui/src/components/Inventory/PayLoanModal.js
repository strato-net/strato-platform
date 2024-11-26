import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import { Images } from '../../images';

const logo = (
  <img src={Images.strats} alt={''} title={''} className="w-5 h-5" />
);

const PayLoanModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  productDetailPage,
}) => {
  const {
    isStaking,
    isUnstaking,
    isreservessLoading,
    isFetchingOracle,
    reserves,
    oracle,
  } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const { paymentServices } = usePaymentServiceState();
  const isLoader =
    isStaking || isUnstaking || isFetchingOracle || isreservessLoading;
  const isStaked = inventory.stratsLoanAmount && inventory.stratsLoanAmount > 0;
  const itemName = decodeURIComponent(inventory.name);
  const resAddress = reserves?.length ? reserves[0]?.address : null;
  const oracleData = oracle ? oracle : { consensusPrice: 0 };

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
  }, []);

  useEffect(() => {
    if (reserves && inventory.data && !isreservessLoading && !isStaked) {
      inventoryActions.getOracle(inventoryDispatch, reserves[0].oracle);
    }
  }, [resAddress]);

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={
        <div className="text-2xl md:text-3xl font-bold pl-4">
          Collateral: {itemName}
        </div>
      }
      width={600}
      centered
      footer={null}
    >
      <div className="flex flex-col px-4 pt-4">
        Pay Loan
      </div>
    </Modal>
  );
};

export default PayLoanModal;
