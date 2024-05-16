import React from "react";
import {
  Modal,
  Button,
} from "antd";
import { actions } from "../../contexts/sellerStatus/actions";
import { useSellerStatusState, useSellerStatusDispatch } from "../../contexts/sellerStatus";
import { SELLER_STATUS } from '../../helpers/constants';

const RequestBeAuthorizedSellerModal = ({
  open,
  handleCancel,
  commonName,
  emailAddr,
  sellerStatus,
  setSellerStatus
}) => {
  const dispatch = useSellerStatusDispatch();
  const { requestingReview } = useSellerStatusState();
  async function sendRequest(){
    try{
      await actions.requestReview(dispatch, {emailAddr: emailAddr, commonName: commonName});
      setSellerStatus(SELLER_STATUS.PENDING_REVIEW);
    } catch {}
    handleCancel();
  }

  const requestReviewText = 'Thank you for interest in being an issuer of new products for sale on Mercata! To keep our platform safe, we must first verify you as an issuer. Click the button to request a review, and our team will get back to you shortly with our response!';
  const alreadyRequestedReviewText = 'Thank you for interest in being an issuer of new products for sale on Mercata! You have already requested to be reviewed as an issuer. Our team will get back to you shortly with a response. If you have questions, please feel free to reach out to sales@blockapps.net';
  
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
              loading={requestingReview}
              disabled={sellerStatus === SELLER_STATUS.PENDING_REVIEW}
            >
              Request Review
            </Button>
          </div>,
        ]}
      >
        <h1 className=" font-semibold text-lg text-[#202020]">
          Issuer Authorization
        </h1>
        <p> {sellerStatus === SELLER_STATUS.PENDING_REVIEW ? alreadyRequestedReviewText : requestReviewText } </p>
        
      </Modal>
    </>
  );
};

export default RequestBeAuthorizedSellerModal;