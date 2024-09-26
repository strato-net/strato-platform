import React, { useState } from "react";
import { Button, Spin } from "antd";

const ConfirmationModal = ({ isOpen, onClose, onConfirm, product, actionType, isLoading, isConfirmed }) => {
    if (!isOpen) return null;

    if (isLoading) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
                <div className="bg-white w-[400px] lg:w-[550px] lg:h-[440px] px-8 py-4 rounded-lg shadow-lg">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-semibold">Processing</h2>
                    </div>
                    <p className="text-lg">Please wait while we process your request.</p>
                    <div className="flex justify-center items-center h-80">
                        <Spin className="w-max h-max" tip="Loading..." size="large" />
                    </div>
                </div>
            </div>
        );
    }

    if (isConfirmed) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
                <div className="bg-white w-[400px] lg:w-[550px] lg:h-[440px] px-8 py-4 rounded-lg shadow-lg">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-semibold">Success</h2>
                        <button
                            onClick={onClose}
                            className="text-xl text-gray-400 hover:text-gray-600"
                        >
                            &#x2715;
                        </button>
                    </div>
                    <p className="text-lg my-3">Your request was successful!</p>
                    <div className="flex justify-center items-center my-14">
                        <div className="h-40 bg-green-200 rounded-full flex items-center justify-center">
                            <span className="text-4xl">✓</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const getActionLabel = () => {
        switch (actionType) {
            case "accept":
                return "Accept Offer";
            case "decline":
                return "Decline Offer";
            case "cancel":
                return "Cancel Offer";
            default:
                return "Confirm Action";
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
            <div className="bg-white w-[400px] lg:w-[550px] px-8 py-4 rounded-lg shadow-lg">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">
                        {getActionLabel()}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-xl text-gray-400 hover:text-gray-600"
                    >
                        &#x2715;
                    </button>
                </div>
                <p className="text-[#5D5D5D] text-lg my-2">
                    Are you sure you want to {actionType} this offer?
                </p>
                <div className="bg-[#EEEEF8] p-3 mb-8 flex flex-col gap-2">
                    {actionType === "cancel" ? null : (<p className="text-sm">
                        Offerer: <span className="font-semibold">{product?.offerer}</span>
                    </p>)}
                    <p className="text-sm">
                        Price: <span className="font-semibold">{product?.price} STRATS</span>
                    </p>
                    <p className="text-sm">
                        Quantity: <span className="font-semibold">{product?.quantity}</span>
                    </p>
                    <p className="text-sm">
                        Total Price: <span className="font-semibold">{product?.totalPrice} STRATS</span>
                    </p>
                </div>

                {/* Buttons Section */}
                <div className="flex">
                    {actionType === "accept" && (
                        <Button
                            type="primary"
                            className="w-full h-9 !bg-[#13188A] !hover:bg-primaryHover !text-white"
                            onClick={onConfirm}
                        >
                            Accept Offer
                        </Button>
                    )}
                    {actionType === "decline" && (
                        <Button
                            type="primary"
                            className="w-full h-9 !bg-[#B63B38] !text-white"
                            onClick={onConfirm}
                        >
                            Decline Offer
                        </Button>
                    )}
                    {actionType === "cancel" && (
                        <Button
                            type="primary"
                            className="w-full h-9 !bg-[#B63B38] !text-white"
                            onClick={onConfirm}
                        >
                            Cancel Offer
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
