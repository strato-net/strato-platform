import React, { useState } from "react";
import { Form, Modal, InputNumber, Button, Spin, Table } from "antd";
import { ConsoleSqlOutlined } from "@ant-design/icons";

import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";

import { actions } from "../../contexts/inventory/actions";
import { INVENTORY_STATUS } from "../../helpers/constants";
import TagManager from "react-gtm-module";

const PublishNowModal = ({
  open,
  handleCancel,
  user,
  formik,
  getIn,
  inventory
}) => {
  const seller = user.user.organization;
  const membership = formik.values.name;
  console.log("formik.values", formik.values);
  console.log("inventory", inventory);
  const dispatch = useInventoryDispatch();

  const onUpdateInventory_ = async (inventory_) => {
        const body = {
          productAddress: inventory_.productId,
          inventory: inventory_.address,
          updates: {
            pricePerUnit: inventory_.pricePerUnit,
            status: inventory_.status == 2 ? INVENTORY_STATUS['PUBLISHED'] : INVENTORY_STATUS['UNPUBLISHED'],
          },
        };

        let isDone = await actions.updateInventory(dispatch, body);
         window.location.replace("/marketplace/memberships/")
    }

  const columns = [
    {
      title: "Seller",
      dataIndex: "seller",
      key: "seller",
    },
    {
      title: "Membership",
      dataIndex: "membership",
      key: "membership",
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
    },
    {
      title: "Price",
      dataIndex: "price",
      key: "price",
    },
  ];

  const data = [
    {
      key: "1",
      seller: seller,
      membership: membership,
      quantity: (
        <>
          <InputNumber
            id="quantity"
            name="quantity"
            min={0}
            value={formik.values.quantity}
            onChange={(value) => {
              formik.setFieldValue("quantity", value);
            }}
          />
          {getIn(formik.touched, `quantity`) && getIn(formik.errors, `quantity`) && (
            <span className="text-error text-xs">
              {getIn(formik.errors, `quantity`)}
            </span>
          )}
        </>
      ),
      price: (
        <>
          <InputNumber
            id="price"
            name="price"
            min={0}
            value={formik.values.price}
            onChange={(value) => {
              formik.setFieldValue("price", value);
            }}
          />
          {getIn(formik.touched, `price`) && getIn(formik.errors, `price`) && (
            <span className="text-error text-xs">
              {getIn(formik.errors, `price`)}
            </span>
          )}
        </>
      ),
    },
  ];

  return (
    <Modal
      title={"Are you sure you want to change the status of this inventory?"}
      open={open}
      onCancel={handleCancel}
      onOk={formik.handleSubmit}
      footer={[
        <Button
          key="list-now"
          onClick={onUpdateInventory_.bind(this, inventory)}
          onCancel={handleCancel}
          type="primary"
        >
          Change to {inventory.status !== 1 ? "Published" : "Unpublished" }
        </Button>,
      ]}
    >
    </Modal>
  );
};

export default PublishNowModal;
