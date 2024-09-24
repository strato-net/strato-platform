import { useEffect, useState } from "react";
import { Button as AntButton, InputNumber, Spin } from "antd"; // Spin for loading
import { ReactComponent as WalletIcon } from "../../images/offer-images/wallet-icon.svg";
import { ReactComponent as StratIcon } from "../../images/offer-images/strats-icon.svg";
import { ReactComponent as SuccessIcon } from "../../images/offer-images/offer-success.svg";
import { useFormik } from "formik";
import * as Yup from "yup";

const MakeOfferModal = ({
  isOpen,
  onClose,
  product = {
    title: "Lorem ipsum dolor sit amet ",
    owner: "andrew",
    price: "$30",
    strats: 3000,
    quantity: 10,
    saleAddress: "0x1234abcd5678efgh",
    productId: "prod_123456",
    category: "Electronics",
    imageUrl: "https://via.placeholder.com/100", // Example image placeholder URL
  },
}) => {
  const [isConfirming, setIsConfirming] = useState(false); // For confirmation modal
  const [isLoading, setIsLoading] = useState(false); // For loading state
  const [isConfirmed, setIsConfirmed] = useState(false); // For final confirmation screen

  const formik = useFormik({
    initialValues: {
      quantity: 1,
      price: 0,
    },
    validationSchema: Yup.object({
      quantity: Yup.number()
        .min(1, "*Quantity must be at least 1")
        .max(
          product.quantity,
          `*Quantity must be less than ${product.quantity}`
        )
        .nullable()
        .transform((value) => (isNaN(value) ? 1 : value))
        .required("*Quantity is required"),
      price: Yup.number()
        .min(1, "*Price must be greater than 0")
        .nullable()
        .transform((value) => (isNaN(value) ? 1 : value))
        .max(
          product.strats,
          `*Price must be less than ${product.strats} STRATS`
        )
        .required("*Price is required"),
    }),
    onSubmit: (values) => {
      // Form is only submitted when user clicks "Approve"
      setIsLoading(true); // Show loading screen
      setTimeout(() => {
        setIsLoading(false); // After loading, show final confirmation screen
        setIsConfirmed(true);
      }, 2000); // Simulate loading delay
    },
  });

  const calculateTotalCost = (values) => {
    return values.quantity * values.price;
  };

  // This is to prevent scrolling when the modal is open. It will disable the body scroll.
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

  // Loading Screen when an offer is being submitted
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
        <div className="bg-white w-[400px] lg:w-[550px] lg:h-[440px] px-8 py-4 rounded-lg shadow-lg">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Make an Offer</h2>
          </div>
          <p className="text-lg ">Please wait while we submit your offer.</p>
          {/* Loading Spinner */}
          <div className="flex justify-center items-center h-80">
            <Spin className="w-max h-max" tip="Loading..." size="large" />
          </div>
        </div>
      </div>
    );
  }

  // Confirmation Modal, Shows after a successful offer is made
  if (isConfirmed) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
        <div className="bg-white w-[400px] lg:w-[550px] lg:h-[440px] px-8 py-4 rounded-lg shadow-lg">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Make an Offer</h2>
            <button
              onClick={onClose}
              className="text-xl text-gray-400 hover:text-gray-600"
            >
              &#x2715;
            </button>
          </div>
          <p className="text-lg my-3">Your offer was made successfully!</p>
          <div className="flex justify-center items-center my-14">
            <SuccessIcon className="h-40" />
          </div>

          {/* Offer Status*/}
          <div className="text-center flex flex-col justify-end h-max">
            <p className=" text-[#7E7878] leading-loose">
              You can check your offer status at any time
            </p>
            <AntButton
              type="primary"
              className=""
              onClick={() => {
                setIsConfirming(false); // Reset state
                setIsConfirmed(false);
                onClose(); // Close modal
              }}
            >
              Check Status
            </AntButton>
          </div>
        </div>
      </div>
    );
  }

  // Render the confirmation modal
  if (isConfirming) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
        <div className="bg-white w-[400px] lg:w-[550px] lg:h-[440px] px-8 py-4 rounded-lg shadow-lg">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Make an Offer</h2>
            <button
              onClick={onClose}
              className="text-xl text-gray-400 hover:text-gray-600"
            >
              &#x2715;
            </button>
          </div>
          <p className="text-[#5D5D5D] text-lg my-2">
            Please take a moment to review your offer.
          </p>
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

          {/* Confirmation Section */}
          <div className="bg-[#EEEEF8] p-3 mb-8 flex flex-col gap-2">
            <p className="text-sm">
              Quantity:{" "}
              <span className="font-semibold">{formik.values.quantity}</span>
            </p>
            <p className="text-sm">
              Price:{" "}
              <span className="font-semibold">
                {formik.values.price} STRATS
              </span>
            </p>
            <p className="text-sm">
              Total Cost:{" "}
              <span className="font-semibold">
                {calculateTotalCost(formik.values)} STRATS
              </span>
            </p>
          </div>

          {/* Buttons Section */}
          <div className="flex justify-between">
            {/* Submitting the form when user clicks approve.  */}
            <AntButton
              type="primary"
              className="w-[48%] h-9 !bg-[#13188A] !hover:bg-primaryHover !text-white"
              onClick={formik.handleSubmit}
            >
              Approve
            </AntButton>
            <AntButton
              type="default"
              className="w-[48%] h-9"
              onClick={() => {
                setIsConfirming(false); // Go back to previous screen.
              }}
            >
              Back
            </AntButton>
          </div>
        </div>
      </div>
    );
  }

  // Initial form to enter offer details.
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white w-[400px] lg:w-[550px] lg:h-[440px] px-8 py-4 rounded-lg shadow-lg">
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

        <form>
          {/* Cost Section */}
          <div className="bg-[#EEEEF8] p-3 mb-8 flex items-center">
            <WalletIcon className="" />
            <p className="text-xs text-[#7E7878] px-2">
              Total Cost: {calculateTotalCost(formik.values)} STRATS
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
                <p className="text-error text-xs">{formik.errors.quantity}</p>
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
                <p className="text-error text-xs">{formik.errors.price}</p>
              ) : null}
            </div>
          </div>

          {/* Buttons Section */}
          <div>
            <AntButton
              type="primary"
              className="w-[100%] h-9 !bg-[#13188A] !hover:bg-primaryHover !text-white"
              onClick={() => setIsConfirming(true)} // Show confirmation modal
              disabled={!formik.isValid || !formik.dirty} // Disable until form is valid and dirty
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
