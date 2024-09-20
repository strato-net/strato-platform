import { useEffect } from "react";
import { InputNumber, Button as AntButton } from "antd";
import { ReactComponent as WalletIcon } from "../../images/offerImages/wallet-icon.svg";
import { ReactComponent as StratIcon } from "../../images/offerImages/strats-icon.svg";
import { useFormik } from "formik";
import * as Yup from "yup";

const MakeOfferModal = ({
  isOpen,
  onClose,
  product = {
    title: "Lorem ipsum dolor sit amet ",
    owner: "andrew",
    price: "$30",
    quantity: 25,
    strats: 3000, // Assuming this is the maximum allowed price in STRATS
    saleAddress: "0x1234abcd5678efgh",
    productId: "prod_123456",
    category: "Electronics",
    imageUrl: "https://via.placeholder.com/100", // Example image placeholder URL
  },
}) => {
  const formik = useFormik({
    initialValues: {
      quantity: 1,
      price: 0,
    },
    validationSchema: Yup.object({
      quantity: Yup.number()
        .min(1, "*Quantity must be at least 1")
        .max(product.quantity, `*Quantity must be less than ${product.quantity}`)
        .nullable()
        .transform((value) => (isNaN(value) ? 1 : value))
        .required("*Quantity is required"),
      price: Yup.number()
        .min(1, "*Price must be greater than 0")
        .nullable()
        .transform((value) => (isNaN(value) ? 1 : value))
        .max(product.strats, `*Price must be less than ${product.strats} STRATS`)
        .required("*Price is required"),
    }),
    onSubmit: (values) => {
      const totalCost = values.quantity * values.price;
      alert(`Offer made for ${totalCost} STRATS`);
    },
  });

  const calculateTotalCost = () => {
    return formik.values.quantity * formik.values.price;
  };

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
      <div className="bg-white w-[400px] lg:w-[550px] px-8 py-4 rounded-lg shadow-lg">
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

        <form onSubmit={formik.handleSubmit}>
          {/* Cost Section */}
          <div className="bg-[#EEEEF8] p-3 mb-8 flex items-center">
            <WalletIcon className="" />
            <p className="text-xs text-[#7E7878] px-2">
              Total Cost: {calculateTotalCost()} STRATS
            </p>
            <StratIcon />
          </div>

          {/* Input Section */}
          <div className="flex gap-4 mb-5 content-end">
            <div className="w-full flex flex-col">
              <InputNumber
                min={1}
                max={product.quantity}
                value={formik.values.quantity}
                onChange={(value) => formik.setFieldValue("quantity", value)}
                placeholder="Enter Quantity"
                className="w-full"
                status={formik.errors.quantity ? "error" : ""}
              />
              {formik.touched.quantity && formik.errors.quantity ? (
                <p className="text-error text-xs">
                  {formik.errors.quantity}
                </p>
              ) : null}
            </div>
            <div className="w-full flex flex-col">
              <InputNumber
                min={0}
                max={product.strats}
                value={formik.values.price}
                onChange={(value) => formik.setFieldValue("price", value)}
                placeholder="Enter Price (STRATS)"
                className="w-full"
                status={formik.errors.price ? "error" : ""}
              />
              {formik.touched.price && formik.errors.price ? (
                <p className="text-error text-xs">
                  {formik.errors.price}
                </p>
              ) : null}
            </div>
          </div>

          {/* Buttons Section */}
          <div>
            <AntButton
              type="primary"
              htmlType="submit"
              className="w-[100%] h-9 !bg-[#13188A] !hover:bg-primaryHover !text-white"
            >
              Make Offer
            </AntButton>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MakeOfferModal;
