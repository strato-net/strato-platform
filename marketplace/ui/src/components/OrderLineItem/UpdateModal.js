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
      const [inventoryId, setinventoryId] = useState("");
      const [productId, setproductId] = useState("");
      const [quantity, setquantity] = useState("");
      const [pricePerUnit, setpricePerUnit] = useState("");
      const [createdAt, setcreatedAt] = useState("");

  useEffect(() => {
    if (selectedObj.length) {
      const product = selectedObj[0];

          setorderId(product["orderId"]);
          setinventoryId(product["inventoryId"]);
          setproductId(product["productId"]);
          setquantity(product["quantity"]);
          setpricePerUnit(product["pricePerUnit"]);
          setcreatedAt(product["createdAt"]);
    }
  }, [selectedObj]);
  

  const handleFormSubmit = async () => {
    const body = {
      address: selectedObj[0].address, 
      chainId: selectedObj[0].chainId,
      updates: {
            orderId,
            inventoryId,
            productId,
            quantity,
            pricePerUnit,
            createdAt,
      },
    };

    let isDone = await actions.updateOrderLineItem(dispatch, body); 

    if (isDone) {
      actions.fetchOrderLineItem(dispatch, 10, 0, debouncedSearchTerm);
      toggleUpdateModal(false);
    }
  }

  // const isDisabled = (  !orderId  ||  !inventoryId  ||  !productId  ||  !quantity  ||  !pricePerUnit  ||  !createdAt    );

  const primaryAction = {
    content: "Update OrderLineItem",
    disabled: false,
    onAction: handleFormSubmit,
    loading: isUpdating
  };

  return (
    <Modal
      open={isUpdateModalOpen}
      onClose={() => toggleUpdateModal(!isUpdateModalOpen)}
      title={"Update OrderLineItem"}
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
                        label="inventoryId"
                        type={ "text" }
                        value={ inventoryId }
                        onChange={(val) => setinventoryId(val) }
                      />


                    <TextField
                        label="productId"
                        type={ "text" }
                        value={ productId }
                        onChange={(val) => setproductId(val) }
                      />


                    <TextField
                        label="quantity"
                        type={ "number" }
                        value={ quantity }
                        onChange={(val) => setquantity(val) }
                      />


                    <TextField
                        label="pricePerUnit"
                        type={ "number" }
                        value={ pricePerUnit }
                        onChange={(val) => setpricePerUnit(val) }
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
