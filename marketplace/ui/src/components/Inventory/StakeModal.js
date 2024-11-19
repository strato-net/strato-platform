import { Button, Modal, Table, notification } from "antd";
import { useEffect, useState } from "react";
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from "../../contexts/payment";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as paymentServiceActions } from "../../contexts/payment/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useMarketplaceDispatch } from "../../contexts/marketplace";
import { Images } from "../../images";

const logo = (
  <img src={Images.strats} alt={""} title={""} className="w-5 h-5 " />
);

const StakeModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  type,
  productDetailPage,
}) => {
  const {
    isStaking,
    isUnstaking,
    isReserveAddress,
    isCalculatedValue,
    reserveAddress,
    calculatedValue,
  } = useInventoryState();

  const [data, setData] = useState(inventory);
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const { paymentServices } = usePaymentServiceState();

  const quantityIsDecimal =
    data.data.quantityIsDecimal && data.data.quantityIsDecimal === "True";
  const isLoader =
    isStaking || isUnstaking || isCalculatedValue || isReserveAddress;
  const isStaked = inventory.stratsLoanAmount && inventory.stratsLoanAmount > 0;
  const itemName = decodeURIComponent(inventory.name);
  const resAddress = reserveAddress?.length ? reserveAddress[0]?.address : null;

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
  }, []);

  useEffect(() => {
    if (reserveAddress && inventory.data && !isReserveAddress && !isStaked) {
      const body = {
        assetAmount: inventory?.quantity,
        loanToValueRatio: reserveAddress[0].loanToValueRatio,
      };
      inventoryActions.calculateValue(inventoryDispatch, body);
    }
  }, [resAddress]);

  const columns = [
    {
      title: "Quantity",
      dataIndex: "quantity",
      align: "center",
      render: (text, record) =>
        quantityIsDecimal ? record.quantity / 100 : record.quantity,
    },
    {
      title: "Loan Amount (STRATs)",
      align: "center",
      render: (text, record) => (
        <div className="flex justify-center">
          {" "}
          <div className="flex mx-auto">
            {isStaked ? record.stratsLoanAmount : calculatedValue} {logo}{" "}
          </div>{" "}
        </div>
      ),
    },
    {
      align: "center",
      render: () => (
        <Button
          type="primary"
          className="w-32 h-9"
          onClick={handleSubmit}
          disabled={isLoader}
          loading={isLoader}
        >
          {type}
        </Button>
      ),
    },
  ];

  const handleSubmit = async () => {
    const stratsService = paymentServices.find(
      (item) => item.serviceName === "STRATS" && item.creator === "Server"
    );
    if (type === "Stake") {
      const body = {
        assetAmount: inventory?.quantity,
        assetAddress: inventory?.address,
        stratPaymentService: {
          creator: stratsService.creator,
          serviceName: stratsService.serviceName,
        },
        reserve: reserveAddress[0].address,
      };

      const isStaked = await inventoryActions.stakeInventory(
        inventoryDispatch,
        body
      );
      if (isStaked) {
        if (productDetailPage) {
          await inventoryActions.fetchInventoryDetail(inventoryDispatch, productDetailPage);
        }
        else{
          await inventoryActions.fetchInventory(
            inventoryDispatch,
            limit,
            offset,
            debouncedSearchTerm,
            category && category !== "All" ? category : undefined
          );
        }
        await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
        handleCancel();
      }
    }

    if (type === "Unstake") {
      const body = {
        escrow: inventory?.sale,
        stratsPaymentService: stratsService.address,
      };
      const isUnstaked = await inventoryActions.UnstakeInventory(
        inventoryDispatch,
        body
      );
      if (isUnstaked) {
        if (productDetailPage) {
          await inventoryActions.fetchInventoryDetail(inventoryDispatch, productDetailPage);
        } else{
          await inventoryActions.fetchInventory(
            inventoryDispatch,
            limit,
            offset,
            debouncedSearchTerm,
            category && category !== "All" ? category : undefined
          );
        }
        await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
        handleCancel();
      }
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={`${type} - ${itemName}`}
      width={1000}
      footer={[]}
    >
      <div className="head hidden md:block">
        <Table columns={columns} dataSource={[data]} pagination={false} />
      </div>
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          {" "}
          <p className="text-[#202020] font-medium text-sm">
            Quantity
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p> {inventory?.quantity}</p>
          </div>
        </div>
        <div className="w-full">
          <p className=" w-full text-[#202020] font-medium text-sm ">
            Loan Amount (STRATs)
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center ">
            <div className="flex mx-auto">
              {isStaked ? inventory.stratsLoanAmount : calculatedValue} {logo}{" "}
            </div>{" "}
          </div>
        </div>
        <div className="w-full flex justify-center items-center">
          <Button
            type="primary"
            className="w-32 h-9"
            onClick={handleSubmit}
            disabled={isLoader}
            loading={isLoader}
          >
            {type}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default StakeModal;
