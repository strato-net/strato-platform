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

      const [name, setname] = useState("");
      const [description, setdescription] = useState("");
      const [categoryId, setcategoryId] = useState("");
      const [createdAt, setcreatedAt] = useState("");

  useEffect(() => {
    if (selectedObj.length) {
      const product = selectedObj[0];

          setname(product["name"]);
          setdescription(product["description"]);
          setcategoryId(product["categoryId"]);
          setcreatedAt(product["createdAt"]);
    }
  }, [selectedObj]);
  

  const handleFormSubmit = async () => {
    const body = {
      address: selectedObj[0].address, 
      chainId: selectedObj[0].chainId,
      updates: {
            name,
            description,
            categoryId,
            createdAt,
      },
    };

    let isDone = await actions.updateSubCategory(dispatch, body); 

    if (isDone) {
      actions.fetchSubCategory(dispatch, 10, 0, debouncedSearchTerm);
      toggleUpdateModal(false);
    }
  }

  // const isDisabled = (  !name  ||  !description  ||  !categoryId  ||  !createdAt    );

  const primaryAction = {
    content: "Update SubCategory",
    disabled: false,
    onAction: handleFormSubmit,
    loading: isUpdating
  };

  return (
    <Modal
      open={isUpdateModalOpen}
      onClose={() => toggleUpdateModal(!isUpdateModalOpen)}
      title={"Update SubCategory"}
      primaryAction={primaryAction}
    >
      <Card>
        <Card.Section>
          <Layout>
            <Layout.Section>
              <FormLayout>
                <FormLayout.Group>

                    <TextField
                        label="name"
                        type={ "text" }
                        value={ name }
                        onChange={(val) => setname(val) }
                      />


                    <TextField
                        label="description"
                        type={ "text" }
                        value={ description }
                        onChange={(val) => setdescription(val) }
                      />


                    <TextField
                        label="categoryId"
                        type={ "text" }
                        value={ categoryId }
                        onChange={(val) => setcategoryId(val) }
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
