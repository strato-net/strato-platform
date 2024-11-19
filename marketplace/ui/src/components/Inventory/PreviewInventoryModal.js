import React, { useState } from 'react';
import { Modal, Tabs, Button } from 'antd';
import { MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuthenticateState } from '../../contexts/authentication';
import image_placeholder from '../../images/resources/image_placeholder.png';

const PreviewInventoryModal = ({ open, handleCancel, inventory, category }) => {
  const [quantity, setQuantity] = useState(1);

  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();

  const subtract = () => {
    if (quantity > 1) {
      let value = quantity - 1;
      setQuantity(value);
    }
  };

  const add = () => {
    let value = quantity + 1;
    setQuantity(value);
  };

  const getCategory = () => {
    const parts = inventory.contract_name.split('-');
    return parts[parts.length - 1];
  };

  const Description = ({ item }) => {
    const itemData = item.data;

    switch (getCategory()) {
      case 'Art':
        return (
          <div>
            <div className="flex items-center">
              <p className="text-primaryC text-sm w-44">Artist</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{itemData.artist}</p>
            </div>
          </div>
        );
      case 'CarbonOffset':
        return (
          <>
            {/* <div>
              <div className="flex items-center">
                <p className="text-primaryC text-sm w-44">Project Type</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">{itemData.projectType}</p>
              </div>
            </div> */}
            <div>
              <div className="flex items-center">
                <p className="text-primaryC text-sm w-44">Quantity</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {itemData.quantity}
                </p>
              </div>
            </div>
          </>
        );
      case 'Clothing':
        return (
          <>
            <div>
              <div className="flex items-center">
                <p className="text-primaryC text-sm w-44">Brand</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">{itemData.brand}</p>
              </div>
            </div>
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Condition</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.condition ? itemData.condition.toUpperCase() : null}
              </p>
            </div>
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">SKU</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.skuNumber
                  ? itemData.skuNumber.toUpperCase()
                  : 'No SKU Available'}
              </p>
            </div>
          </>
        );
      case 'Metals':
        return (
          <div>
            <div className="flex items-center">
              <p className="text-primaryC text-sm w-44">Source</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{itemData.source}</p>
            </div>
          </div>
        );
      default:
        break;
    }
  };

  return (
    <Modal
      open={open}
      centered
      onCancel={handleCancel}
      footer={[]}
      width={1000}
    >
      <hr className="text-secondryD mt-8" />
      <div className="flex items-start w-full mt-5">
        <div className="w-2/5 flex flex-col items-center h-full">
          <img
            className="w-60 object-cover"
            alt=""
            src={
              inventory.images && inventory.images.length > 0
                ? inventory.images[0]
                : image_placeholder
            }
          />
          <div className="flex justify-center mt-16">
            <Button
              className="h-11 bg-primary text-white w-9/12"
              disabled={user?.commonName === inventory.ownerCommonName}
            >
              Add To Cart
            </Button>

            <Button
              className="h-11 bg-primary text-white w-9/12 ml-4"
              disabled={user?.commonName === inventory.ownerCommonName}
            >
              Buy now
            </Button>
          </div>
        </div>
        <div className="w-3/5">
          <div className="flex items-center">
            <h3 className="font-semibold text-primaryB text-xl">
              {decodeURIComponent(inventory.name)}
            </h3>
            <p className="font-medium text-secondryB text-base ml-2">
              ({getCategory()})
            </p>
          </div>
          <p className="text-xs text-secondryB mt-1.5">
            {decodeURIComponent(inventory.description)}
          </p>
          {inventory.price ? (
            <h3 className="font-semibold text-primaryB text-xl mt-3">
              ${inventory.price}
            </h3>
          ) : (
            <></>
          )}
          <h5 className="font-medium text-primaryB text-sm mt-3">Quantity</h5>
          <div className="flex items-center mt-2">
            <div
              onClick={subtract}
              className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer"
            >
              <MinusOutlined className="text-xs text-secondryD" />
            </div>
            <div className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center">
              {quantity}
            </div>
            <div
              onClick={add}
              className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer"
            >
              <PlusOutlined className="text-xs text-secondryC" />
            </div>
          </div>
          <Tabs
            className="mt-3"
            defaultActiveKey="1"
            items={[
              {
                label: <p className="font-medium text-sm">Description</p>,
                key: 'Description',
                children: <Description data={inventory} />,
              },
              {
                label: (
                  <p className="font-medium text-strike-m">Ownership History</p>
                ),
                key: 'Ownership History',
                disabled: true,
              },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
};

export default PreviewInventoryModal;
