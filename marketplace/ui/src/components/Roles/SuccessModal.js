import React from "react";
import { Modal,Image } from "antd";
import { Images } from "../../images";

const SuccessModal = ({ open, handleCancel }) => {
  return (
    <Modal
      open={open}
      centered
      onCancel={handleCancel}
      footer={[]}
    >
      <div className="flex flex-col justify-around items-center my-10">
      <Image src={Images["role-request"]}  preview={false} />
        <p className="text-center mt-4 font-semibold text-primaryC text-lg">
        Your request will be reviewed by the Admin
        </p>
      </div>
    </Modal>
  );
};

export default SuccessModal;
