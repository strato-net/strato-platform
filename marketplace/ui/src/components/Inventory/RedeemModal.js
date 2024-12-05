import { Button, InputNumber, Modal, Table, Input, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { actions } from '../../contexts/inventory/actions';
import { useInventoryDispatch } from '../../contexts/inventory';
import { actions as redemptionActions } from '../../contexts/redemption/actions';
import {
  useRedemptionDispatch,
  useRedemptionState,
} from '../../contexts/redemption';
import { useAuthenticateState } from '../../contexts/authentication';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { MinusCircleOutlined } from '@ant-design/icons';
import AddressComponent from '../MarketPlace/AddressComponent';
import AddAddressModal from '../MarketPlace/AddAddressModal';
import ResponsiveAddAddress from '../MarketPlace/ResponsiveAddAddress';
import { Images } from '../../images';
import { REDEMPTION_STATUS } from '../../helpers/constants';
import { useLocation } from 'react-router-dom';

const RedeemModal = ({
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
  const [comments, setComments] = useState('');
  const inventoryDispatch = useInventoryDispatch();
  const redemptionDispatch = useRedemptionDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const [canRedeem, setCanRedeem] = useState(true);
  const [selectedAddress, setSelectedAddress] = useState(0);
  const [showModal, setshowModal] = useState(false);
  const [showResponsiveForm, setShowResponsiveForm] = useState(false);
  const { user } = useAuthenticateState();
  const { isRequestingRedemption } = useRedemptionState();
  const { userAddresses, isLoadingUserAddresses } = useMarketplaceState();
  const { TextArea } = Input;

  const displayQuantity = inventory.quantity;

  const closeAddressModel = () => {
    setshowModal(false);
  };

  const closeResponsiveAddressModel = () => {
    setShowResponsiveForm(false);
  };

  useEffect(() => {
    marketplaceActions.fetchUserAddresses(
      marketplaceDispatch,
      inventory.data.redemptionService
    );
  }, [marketplaceDispatch]);

  useEffect(() => {
    if (quantity > displayQuantity || quantity <= 0) {
      setCanRedeem(false);
    } else {
      setCanRedeem(true);
    }
  }, [quantity]);

  const columns = [
    {
      title: 'Quantity Available',
      dataIndex: 'quantity',
      align: 'center',
      render: () => <div>{displayQuantity}</div>,
    },
    {
      title: 'Set Quantity',
      align: 'center',
      render: () => (
        <InputNumber
          value={quantity}
          controls={false}
          min={1}
          max={displayQuantity}
          onChange={(value) => setQuantity(value)}
          precision={0}
        />
      ),
    },
    {
      title: 'Additional comments',
      align: 'center',
      render: () => (
        <TextArea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
        />
      ),
    },
  ];

  const handleSubmit = async () => {
    const body = {
      assetAddresses: [inventory.address],
      redemptionService: inventory.data.redemptionService,
      assetName: inventory.name,
      status: REDEMPTION_STATUS.PENDING,
      quantity: quantity,
      shippingAddressId: userAddresses[selectedAddress].address_id,
      ownerCommonName: user.commonName,
      issuerCommonName: inventory.creator,
      ownerComments: comments,
      userAddress: user.userAddress,
    };

    if (quantity > 0 && quantity <= displayQuantity) {
      let isDone = await redemptionActions.requestRedemption(
        redemptionDispatch,
        body
      );
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
      title={`Redeem - ${decodeURIComponent(inventory.name)}`}
      width={1200}
      centered
      footer={[
        <div className="flex justify-center md:block">
          <Button
            type="primary"
            className="w-32 h-9"
            onClick={handleSubmit}
            disabled={!canRedeem || showResponsiveForm}
            loading={isRequestingRedemption}
          >
            Redeem
          </Button>
        </div>,
      ]}
    >
      <div className="head hidden md:block">
        <Table columns={columns} dataSource={data} pagination={false} />
        <div className="flex gap-4 mt-4">
          <p className="text-base md:text-xl lg:text-2xl text-[#202020] font-semibold ">
            Address Details
          </p>
          {showModal ? (
            <MinusCircleOutlined
              className="text-xl text-primary"
              onClick={() => {
                setshowModal(false);
              }}
            />
          ) : (
            <>
              <div className="hidden md:block">
                <Button
                  type="link"
                  icon={
                    <img
                      src={Images.AddBlack}
                      className="w-4 h-4 lg:w-6 lg:h-6 "
                      alt="add"
                    />
                  }
                  onClick={() => {
                    setshowModal(true);
                  }}
                />
              </div>
            </>
          )}
        </div>
        {showModal && (
          <AddAddressModal
            open={showModal}
            close={closeAddressModel}
            redemptionService={inventory.data.redemptionService}
          />
        )}
        {isLoadingUserAddresses ? (
          <div className="h-80 flex justify-center items-center">
            <Spin spinning={isLoadingUserAddresses} size="large" />
          </div>
        ) : userAddresses && userAddresses.length !== 0 ? (
          <div className="grid grid-rows-2 sm:grid-rows-1 grid-flow-col gap-4 lg:flex  lg:flex-wrap overflow-x-auto lg:overflow-y-auto hide-Scroll lg:gap-x-6 lg:gap-y-[20px] pt-4 h-[50%] lg:h-[44vh]">
            {userAddresses.map((add, index) => (
              <div key={index}>
                <div
                  className={`w-[307px] h-[200px] overflow-x-auto hide-Scroll py-3 px-[14px] rounded-[4px] ${
                    index !== selectedAddress
                      ? ' cursor-pointer border border-[#0000002E] '
                      : ' border border-primary cursor-pointer'
                  }`}
                  onClick={() => {
                    setSelectedAddress(index);
                  }}
                >
                  <AddressComponent userAddress={add} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex justify-center items-center h-48 ">
            <p className="text-2xl font-semibold text-[#202020]">
              Please Add Address
            </p>
          </div>
        )}
      </div>
      {/****** MOBILE VIEW ******/}
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={displayQuantity}
              min={1}
              disabled
            />
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
              max={displayQuantity}
              onChange={(value) => setQuantity(value)}
              precision={0}
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">
            Additional comments
          </p>
          <div>
            <TextArea
              className="w-full"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>
        </div>
        {isLoadingUserAddresses ? (
          <div className="h-80 flex justify-center items-center">
            <Spin spinning={isLoadingUserAddresses} size="large" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 mt-4">
              <p className="text-base md:text-xl lg:text-2xl text-[#202020] font-semibold">
                Address Details
              </p>
              {showResponsiveForm ? (
                <MinusCircleOutlined
                  className="text-xl text-primary"
                  onClick={() => {
                    setShowResponsiveForm(false);
                  }}
                />
              ) : (
                <div className="md:hidden">
                  <Button
                    type="link"
                    icon={
                      <img
                        src={Images.AddBlack}
                        className=" w-4 h-4 lg:w-6 lg:h-6 "
                        alt="add"
                      />
                    }
                    onClick={() => {
                      setShowResponsiveForm(true);
                    }}
                  />
                </div>
              )}
            </div>
            <div>
              {userAddresses.length !== 0 ? (
                <div className="grid grid-cols-1 grid-flow-row gap-4 overflow-x-auto hide-Scroll pt-4 h-[50%]">
                  {userAddresses.map((add, index) => (
                    <div key={index}>
                      <div
                        className={`w-full h-[200px] overflow-x-auto hide-Scroll py-3 px-[14px] rounded-[4px] ${
                          index !== selectedAddress
                            ? ' cursor-pointer border border-[#0000002E] '
                            : ' border border-primary cursor-pointer'
                        }`}
                        onClick={() => {
                          setSelectedAddress(index);
                        }}
                      >
                        <AddressComponent userAddress={add} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex justify-center items-center h-48 ">
                  <p className="text-2xl font-semibold text-[#202020]">
                    Please Add Address
                  </p>
                </div>
              )}
            </div>
          </>
        )}
        {showResponsiveForm && (
          <ResponsiveAddAddress
            open={showResponsiveForm}
            close={closeResponsiveAddressModel}
            redemptionService={inventory.data.redemptionService}
          />
        )}
      </div>
    </Modal>
  );
};

export default RedeemModal;
