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

      const [productId, setproductId] = useState("");
      const [inventoryId, setinventoryId] = useState("");
      const [serialNumber, setserialNumber] = useState("");
      const [status, setstatus] = useState("");
      const [comment, setcomment] = useState("");
      const [createdAt, setcreatedAt] = useState("");

  useEffect(() => {
    if (selectedObj.length) {
      const product = selectedObj[0];

          setproductId(product["productId"]);
          setinventoryId(product["inventoryId"]);
          setserialNumber(product["serialNumber"]);
          setstatus(product["status"]);
          setcomment(product["comment"]);
          setcreatedAt(product["createdAt"]);
    }
  }, [selectedObj]);
  

  const handleFormSubmit = async () => {
    const body = {
      address: selectedObj[0].address, 
      chainId: selectedObj[0].chainId,
      updates: {
            productId,
            inventoryId,
            serialNumber,
            status,
            comment,
            createdAt,
      },
    };

    let isDone = await actions.updateItem(dispatch, body); 

    if (isDone) {
      actions.fetchItem(dispatch, 10, 0, debouncedSearchTerm);
      toggleUpdateModal(false);
    }
  }

  // const isDisabled = (  !productId  ||  !inventoryId  ||  !serialNumber  ||  !status  ||  !comment  ||  !createdAt    );

  const primaryAction = {
    content: "Update Item",
    disabled: false,
    onAction: handleFormSubmit,
    loading: isUpdating
  };

  return (
    <Modal
      open={isUpdateModalOpen}
      onClose={() => toggleUpdateModal(!isUpdateModalOpen)}
      title={"Update Item"}
      primaryAction={primaryAction}
    >
      <Card>
        <Card.Section>
          <Layout>
            <Layout.Section>
              <FormLayout>
                <FormLayout.Group>

                    <TextField
                        label="productId"
                        type={ "text" }
                        value={ productId }
                        onChange={(val) => setproductId(val) }
                      />


                    <TextField
                        label="inventoryId"
                        type={ "text" }
                        value={ inventoryId }
                        onChange={(val) => setinventoryId(val) }
                      />


                    <TextField
                        label="serialNumber"
                        type={ "text" }
                        value={ serialNumber }
                        onChange={(val) => setserialNumber(val) }
                      />


                    <TextField
                        label="status"
                        type={ "text" }
                        value={ status }
                        onChange={(val) => setstatus(val) }
                      />


                    <TextField
                        label="comment"
                        type={ "text" }
                        value={ comment }
                        onChange={(val) => setcomment(val) }
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
