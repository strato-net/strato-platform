import React, { useState, useEffect } from "react";
import {
  Modal,
  TextField,
  FormLayout,
  Card,
  Layout,
  Popover,
  Button,
  OptionList,
  Stack,
  Label
} from "@shopify/polaris";
import CommonDatePicker from "../CommonDatePicker";
import dayjs from "dayjs";
import styled from "styled-components";

const LabelWrapper = styled.div`
  margin-bottom: 1px;
`;

const UpdateModal = ({
  isUpdateModalOpen,
  toggleUpdateModal,
  dispatch,
  actions,
  isUpdating,
  debouncedSearchTerm,
  selectedObj
}) => {

      const [orderId, setorderId] = useState("");
      const [buyerOrganization, setbuyerOrganization] = useState("");
      const [sellerOrganization, setsellerOrganization] = useState("");
      const [orderDate, setorderDate] = useState("");
      const [orderTotal, setorderTotal] = useState("");
      const [orderShippingCharges, setorderShippingCharges] = useState("");
      const [status, setstatus] = useState("");
      const [paymentDate, setpaymentDate] = useState("");
      const [paidBy, setpaidBy] = useState("");
      const [amountPaid, setamountPaid] = useState("");
      const [fullfilmentDate, setfullfilmentDate] = useState("");
      const [comments, setcomments] = useState("");
      const [createdAt, setcreatedAt] = useState("");

  useEffect(() => {
    if (selectedObj.length) {
      const product = selectedObj[0];

          setorderId(product["orderId"]);
          setbuyerOrganization(product["buyerOrganization"]);
          setsellerOrganization(product["sellerOrganization"]);
          setorderDate(product["orderDate"]);
          setorderTotal(product["orderTotal"]);
          setorderShippingCharges(product["orderShippingCharges"]);
          setstatus(product["status"]);
          setpaymentDate(product["paymentDate"]);
          setpaidBy(product["paidBy"]);
          setamountPaid(product["amountPaid"]);
          setfullfilmentDate(product["fullfilmentDate"]);
          setcomments(product["comments"]);
          setcreatedAt(product["createdAt"]);
    }
  }, [selectedObj]);
  

  const handleFormSubmit = async () => {
    const body = {
      address: selectedObj[0].address, 
      chainId: selectedObj[0].chainId,
      updates: {
            orderId,
            buyerOrganization,
            sellerOrganization,
            orderDate,
            orderTotal,
            orderShippingCharges,
            status,
            paymentDate,
            paidBy,
            amountPaid,
            fullfilmentDate,
            comments,
            createdAt,
      },
    };

    let isDone = await actions.updateOrder(dispatch, body); 

    if (isDone) {
      actions.fetchOrder(dispatch, 10, 0, debouncedSearchTerm);
      toggleUpdateModal(false);
    }
  }

  // const isDisabled = (  !orderId  ||  !buyerOrganization  ||  !sellerOrganization  ||  !orderDate  ||  !orderTotal  ||  !orderShippingCharges  ||  !status  ||  !paymentDate  ||  !paidBy  ||  !amountPaid  ||  !fullfilmentDate  ||  !comments  ||  !createdAt    );

  const primaryAction = {
    content: "Update Order",
    disabled: false,
    onAction: handleFormSubmit,
    loading: isUpdating
  };

  return (
    <Modal
      open={isUpdateModalOpen}
      onClose={() => toggleUpdateModal(!isUpdateModalOpen)}
      title={"Update Order"}
      primaryAction={primaryAction}
    >
      <Card>
        <Card.Section>
          <Layout>
            <Layout.Section>
              <FormLayout>
                <FormLayout.Group>

                    <TextField
                        label="orderId"
                        type={ "text" }
                        value={ orderId }
                        onChange={(val) => setorderId(val) }
                      />


                    <TextField
                        label="buyerOrganization"
                        type={ "text" }
                        value={ buyerOrganization }
                        onChange={(val) => setbuyerOrganization(val) }
                      />


                    <TextField
                        label="sellerOrganization"
                        type={ "text" }
                        value={ sellerOrganization }
                        onChange={(val) => setsellerOrganization(val) }
                      />


                    <TextField
                        label="orderDate"
                        type={ "text" }
                        value={ orderDate }
                        onChange={(val) => setorderDate(val) }
                      />


                    <TextField
                        label="orderTotal"
                        type={ "number" }
                        value={ orderTotal }
                        onChange={(val) => setorderTotal(val) }
                      />


                    <TextField
                        label="orderShippingCharges"
                        type={ "number" }
                        value={ orderShippingCharges }
                        onChange={(val) => setorderShippingCharges(val) }
                      />


                    <TextField
                        label="status"
                        type={ "text" }
                        value={ status }
                        onChange={(val) => setstatus(val) }
                      />


                    <TextField
                        label="paymentDate"
                        type={ "text" }
                        value={ paymentDate }
                        onChange={(val) => setpaymentDate(val) }
                      />


                    <TextField
                        label="paidBy"
                        type={ "text" }
                        value={ paidBy }
                        onChange={(val) => setpaidBy(val) }
                      />


                    <TextField
                        label="amountPaid"
                        type={ "number" }
                        value={ amountPaid }
                        onChange={(val) => setamountPaid(val) }
                      />


                    <TextField
                        label="fullfilmentDate"
                        type={ "text" }
                        value={ fullfilmentDate }
                        onChange={(val) => setfullfilmentDate(val) }
                      />


                    <TextField
                        label="comments"
                        type={ "text" }
                        value={ comments }
                        onChange={(val) => setcomments(val) }
                      />


                    <TextField
                        label="createdAt"
                        type={ "text" }
                        value={ createdAt }
                        onChange={(val) => setcreatedAt(val) }
                      />

                </FormLayout.Group>
              </FormLayout>
            </Layout.Section>
          </Layout>
        </Card.Section>
      </Card>
    </Modal>
  );
};

export default UpdateModal;
