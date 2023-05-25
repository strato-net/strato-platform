import React, { useState } from "react";
import { Modal, Tabs,Button } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import { useAuthenticateState } from "../../contexts/authentication";


const PreviewInventoryModal = ({ open, handleCancel, inventory, category }) => {
  const [quantity, setQuantity] = useState(1);

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();


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
                src={inventory.imageUrl}
              />
              <div className="flex justify-center mt-16">
              <Button
                        className="h-11 bg-primary text-white w-9/12"
                        disabled
                        onClick={() => {
                          if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                            window.location.href = loginUrl;
                          } else {
                          }
                        }}
                      >
                       Add To Cart
                      </Button>
              
                <Button
                        className="h-11 bg-primary text-white w-9/12 ml-4"
                        disabled
                        onClick={() => {
                          if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                            window.location.href = loginUrl;
                          } else {
                          }
                        }}
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
                  ({category.name})
                </p>
              </div>
              <p className="text-xs text-secondryB mt-1.5">
                {decodeURIComponent(inventory.description)}
              </p>
              <h3 className="font-semibold text-primaryB text-xl mt-3">
                $ {inventory.pricePerUnit}
              </h3>
              <h5 className="font-medium text-primaryB text-sm mt-3">
                Quantity
              </h5>
              <div className="flex items-center mt-2">
                <div 
                 onClick={subtract}
                 className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                  <MinusOutlined className="text-xs text-secondryD" />
                </div>
                <div className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center">
                  {quantity}
                </div>
                <div 
                 onClick={add}
                 className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                  <PlusOutlined className="text-xs text-secondryC" />
                </div>
              </div>
              <Tabs
                className="mt-3"
                defaultActiveKey="1"
                items={[
                  {
                    label: <p className="font-medium text-sm">Description</p>,
                    key: "Description",
                    children: (
                      <Description data={inventory} />
                    ),
                  },
                  {
                    label: <p className="font-medium text-strike-m">Events</p>,
                    key: "Events",
                    disabled: true,
                    // children: <Description />,
                  },
                  {
                    label: (
                      <p className="font-medium text-strike-m">
                        Ownership History
                      </p>
                    ),
                    key: "Ownership History",
                    disabled: true,
                    // children: <Description />,
                  },
                ]}
              />
            </div>
          </div>     
    </Modal>
  );
};

const Description = ({ data }) => {
  return (
    <div>
      <div className="flex items-center">
        <p className="text-primaryC text-sm w-44">Universal Product Code</p>
        <p text-secondryB text-sm>
          :
        </p>
        <p className="text-secondryB text-sm ml-3">{data.uniqueProductCode}</p>
      </div>
      <div className="flex mt-px items-center">
        <p className="text-primaryC text-sm w-44">Manufacturer</p>
        <p text-secondryB text-sm>
          :
        </p>
        <p className="text-secondryB text-sm ml-3">{decodeURIComponent(data.manufacturer)}</p>
      </div>
      <div className="flex mt-px items-center">
        <p className="text-primaryC text-sm w-44">Unit of Measurement</p>
        <p text-secondryB text-sm>
          :
        </p>
        <p className="text-secondryB text-sm ml-3">
          {UNIT_OF_MEASUREMENTS[data.unitOfMeasurement]}
        </p>
      </div>
      <div className="flex mt-px items-center">
        <p className="text-primaryC text-sm w-44">Least Sellable Unit</p>
        <p text-secondryB text-sm>
          :
        </p>
        <p className="text-secondryB text-sm ml-3">{data.leastSellableUnit}</p>
      </div>
    </div>
  );
};

export default PreviewInventoryModal;
