import React from 'react';

import { Modal } from 'antd';
import { CheckoutIcon } from '../../images/SVGComponents';

const ConfirmOrderModel = ({ open, handleCancel, handleConfirm }) => {
  return (
    <Modal
      open={open}
      centered
      onCancel={handleCancel}
      footer={[
        <div className="flex justify-evenly">
          <div
            onClick={handleCancel}
            className="w-48 border border-primary rounded text-primary px-4 py-2 text-center cursor-pointer hover:text-white hover:bg-primary"
          >
            No
          </div>
          <div
            id="yes-button"
            onClick={handleConfirm}
            className="w-48 bg-primary rounded text-white px-4 py-2 text-center hover:bg-primaryHover cursor-pointer"
          >
            Yes
          </div>
        </div>,
      ]}
    >
      <h1
        id="modal-title"
        className="text-center font-semibold text-lg text-primaryB"
      >
        Confirm Order
      </h1>
      <hr className="text-secondryD mt-3" />
      <div className="flex flex-col items-center justify-around my-10">
        <CheckoutIcon />
        <p className="text-center mt-4 font-semibold text-primaryC text-lg">
          Do you want to reserve this order?
        </p>
      </div>
    </Modal>
  );
};

export default ConfirmOrderModel;
