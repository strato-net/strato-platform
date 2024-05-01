import React from "react";
import {
  Modal,
  Button,
} from "antd";
import { actions } from "../../contexts/sellerStatus/actions";
import { useSellerStatusState, useSellerStatusDispatch } from "../../contexts/sellerStatus";

const RequestBeAuthorizedSellerModal = ({
  open,
  handleCancel,
  commonName,
  emailAddr
}) => {
  const dispatch = useSellerStatusDispatch();
  function sendRequest(){
    actions.requestReview(dispatch, {email: emailAddr, commonName: commonName});
    handleCancel();
  }
  
  return (
    <>
      <Modal
        open={open}
        centered
        onCancel={handleCancel}
        width={673}
        footer={[
          <div className="flex justify-center mb-5 pt-4">
            <Button
              className="w-40"
              type="primary"
              onClick={sendRequest}
            >
              Request Review
            </Button>
          </div>,
        ]}
      >
        <h1 className=" font-semibold text-lg text-[#202020]">
          Unauthorized to Create Assets
        </h1>
        <p> Thank you for interest in being a seller on Mercata! To keep our platform safe, we must first verify you as a seller. Click the button to request a review, and our team will get back to you shortly with our response!</p>
        
      </Modal>
    </>
  );
};

export default RequestBeAuthorizedSellerModal;