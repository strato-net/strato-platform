import { useEffect, useState } from "react";
import { InputNumber, Button as AntButton } from "antd";
import { ReactComponent as WalletIcon } from "../../images/offerImages/wallet-icon.svg";
import { ReactComponent as StratIcon } from "../../images/offerImages/strats-icon.svg";

const MakeOfferModal = ({
  isOpen,
  onClose,
  product = {
    title: "Lorem ipsum dolor sit amet ",
    owner: "andrew",
    price: "$30",
    strats: 3000,
    saleAddress: "0x1234abcd5678efgh",
    productId: "prod_123456",
    category: "Electronics",
    imageUrl: "https://via.placeholder.com/100", // Example image placeholder URL
  },
}) => {
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);

  const calculateTotalCost = () => {
    return quantity * price;
  };
  
  const handlePriceChange = (value) => {
    if (value === "") {
      return;
    } else {
      setPrice(value);
    }
  }
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white w-[400px] lg:w-[550px] lg:h-[430px] px-8 py-4 rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Make an Offer</h2>
          <button
            onClick={onClose}
            className="text-xl text-gray-400 hover:text-gray-600"
          >
            &#x2715;
          </button>
        </div>

        {/* Product Info */}
        <div className="grid grid-cols-6 lg:grid-cols-7 gap-4 lg:gap-0 mb-8">
          <div className="w-full bg-gray-200 col-span-2 py-2 flex items-center rounded-lg overflow-hidden">
            <img
              src={product.imageUrl}
              alt={product.title}
              className="object-cover w-[110px] h-[110px] rounded-lg"
            />
          </div>
          <div className="flex flex-col col-span-4 lg:col-span-5 py-2 h-full justify-evenly">
            <h3 className="font-bold text-lg lg:text-xl">{product.title}</h3>
            <p className="text-xs text-gray-500">Owned By: {product.owner}</p>
            <p className="text-lg lg:text-xl font-semibold text-[#13188A]">
              {product.price} ({product.strats} STRATS)
            </p>
          </div>
        </div>

        {/* Cost Section */}
        <div className="bg-[#EEEEF8] p-3 mb-8 flex items-center">
          <WalletIcon className="" />
          <p className="text-xs text-[#7E7878] px-2">
            Total Cost: {calculateTotalCost()} STRATS
          </p>
          <StratIcon />
        </div>

        {/* Input Section */}
        <div className="flex gap-4 mb-5">
          <InputNumber
            min={1}
            value={quantity}
            placeholder="Enter Quantity"
            onChange={(value) => setQuantity(value)}
            className="w-full"
          />
          <InputNumber
            min={0}
            value={price}
            placeholder="Enter Price (STRATS)"
            onChange={(value) => handlePriceChange(value)}
            className="w-full"
          />
        </div>

        {/* Buttons Section */}
        <div className="">
          <AntButton
            type="primary"
            className="w-[100%]  h-9 !bg-[#13188A] !hover:bg-primaryHover !text-white"
            onClick={() => alert("Offer made!")}
          >
            Make Offer
          </AntButton>
          {/* <AntButton
            type="primary"
            className="w-[100%] h-9 !bg-[#DDDCFE] !hover:bg-[#FFB84D] !text-[#121888]"
            onClick={() => alert("Redirect to buy STRATS")}
          >
            Buy STRATS
          </AntButton> */}
        </div>
      </div>
    </div>
  );
};

export default MakeOfferModal;
