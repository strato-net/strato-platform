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

      const [eventTypeId, seteventTypeId] = useState("");
      const [itemSerialNumber, setitemSerialNumber] = useState("");
      const [itemNFTAddress, setitemNFTAddress] = useState("");
      const [date, setdate] = useState("");
      const [inventoryId, setinventoryId] = useState("");
      const [productId, setproductId] = useState("");
      const [summary, setsummary] = useState("");
      const [certifiedBy, setcertifiedBy] = useState("");
      const [certifiedDate, setcertifiedDate] = useState("");
      const [createdAt, setcreatedAt] = useState("");

  useEffect(() => {
    if (selectedObj.length) {
      const product = selectedObj[0];

          seteventTypeId(product["eventTypeId"]);
          setitemSerialNumber(product["itemSerialNumber"]);
          setitemNFTAddress(product["itemNFTAddress"]);
          setdate(product["date"]);
          setinventoryId(product["inventoryId"]);
          setproductId(product["productId"]);
          setsummary(product["summary"]);
          setcertifiedBy(product["certifiedBy"]);
          setcertifiedDate(product["certifiedDate"]);
          setcreatedAt(product["createdAt"]);
    }
  }, [selectedObj]);
  

  const handleFormSubmit = async () => {
    const body = {
      address: selectedObj[0].address, 
      chainId: selectedObj[0].chainId,
      updates: {
            eventTypeId,
            itemSerialNumber,
            itemNFTAddress,
            date,
            inventoryId,
            productId,
            summary,
            certifiedBy,
            certifiedDate,
            createdAt,
      },
    };

    let isDone = await actions.updateEvent(dispatch, body); 

    if (isDone) {
      actions.fetchEvent(dispatch, 10, 0, debouncedSearchTerm);
      toggleUpdateModal(false);
    }
  }

  // const isDisabled = (  !eventTypeId  ||  !itemSerialNumber  ||  !itemNFTAddress  ||  !date  ||  !inventoryId  ||  !productId  ||  !summary  ||  !certifiedBy  ||  !certifiedDate  ||  !createdAt    );

  const primaryAction = {
    content: "Update Event",
    disabled: false,
    onAction: handleFormSubmit,
    loading: isUpdating
  };

  return (
    <Modal
      open={isUpdateModalOpen}
      onClose={() => toggleUpdateModal(!isUpdateModalOpen)}
      title={"Update Event"}
      primaryAction={primaryAction}
    >
      <Card>
        <Card.Section>
          <Layout>
            <Layout.Section>
              <FormLayout>
                <FormLayout.Group>

                    <TextField
                        label="eventTypeId"
                        type={ "text" }
                        value={ eventTypeId }
                        onChange={(val) => seteventTypeId(val) }
                      />


                    <TextField
                        label="itemSerialNumber"
                        type={ "text" }
                        value={ itemSerialNumber }
                        onChange={(val) => setitemSerialNumber(val) }
                      />


                    <TextField
                        label="itemNFTAddress"
                        type={ "text" }
                        value={ itemNFTAddress }
                        onChange={(val) => setitemNFTAddress(val) }
                      />


                    <TextField
                        label="date"
                        type={ "text" }
                        value={ date }
                        onChange={(val) => setdate(val) }
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
                        label="summary"
                        type={ "text" }
                        value={ summary }
                        onChange={(val) => setsummary(val) }
                      />


                    <TextField
                        label="certifiedBy"
                        type={ "text" }
                        value={ certifiedBy }
                        onChange={(val) => setcertifiedBy(val) }
                      />


                    <TextField
                        label="certifiedDate"
                        type={ "text" }
                        value={ certifiedDate }
                        onChange={(val) => setcertifiedDate(val) }
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
