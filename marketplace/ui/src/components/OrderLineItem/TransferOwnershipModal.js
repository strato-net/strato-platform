import React, { useState } from "react";
import {
  Modal,
  FormLayout,
  Card,
  Layout,
  Select,
} from "@shopify/polaris";
import { useUsersState } from "../../contexts/users";

const TransferOwnershipModal = ({
  isTransferOwnershipModalOpen,
  toggleTransferOwnershipModal,
  actions,
  dispatch,
  selectedObj,
  isTransferring
}) => {
  const [user, setUser] = useState('');

  const {
    users
  } = useUsersState();

  const handleFormSubmit = async () => {
    const body = {
      address: selectedObj[0].address, 
      chainId: selectedObj[0].chainId, 
      newOwner: user,
    };

    const isDone = await actions.transferOrderLineItemOwnership(dispatch, body);

    if (isDone) {
      toggleTransferOwnershipModal(!isTransferOwnershipModalOpen);
    }
  };
  const usersList = users && users.length ? users.map((u) => ({ label: `${u.commonName} - ${u.organization}`, value: u.userAddress })) : []

  return (
    <Modal
      open={isTransferOwnershipModalOpen}
      onClose={() => toggleTransferOwnershipModal(!isTransferOwnershipModalOpen)}
      title={"Transfer Ownership"}
      primaryAction={ 
        {
          content: "Transfer Ownership",
          onAction: handleFormSubmit,
          loading: isTransferring,
          disabled: !user
        } 
      }
    >
      <Card>
        <Card.Section>
          <Layout>
            <Layout.Section>
              <FormLayout>
                <FormLayout.Group>
                <Select
                    label="Users"
                    options={ [
                      { label: 'Select User', value: '' },
                      ...usersList
                    ]}
                    onChange={(val) => setUser(val)}
                    value={user}
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

export default TransferOwnershipModal;
