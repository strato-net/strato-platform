import React, { useState, useEffect } from "react";
import { Form, Modal, InputNumber, Button, Spin, Select, Table, Typography } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { CaretDownOutlined } from "@ant-design/icons"
import { actions } from "../../contexts/membership/actions";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";

const { Option } = Select;

const ListNowIndex = ({
  open,
  handleCancel,
  user,
  //   formik,
  //   type,
  //   getIn,
  //   isCreateMembershipSubmitting,
}) => {
  const seller = user.user.organization;
  const [possibleMemberships, setPossibleMemberships] = useState([]);
  const [selectedMembership, setSelectedMembership] = useState(null);
  const [productId, setProductId] = useState('')
  const [id, setId] = useState("");
  const [inventoryId, setInventoryId] = useState('')
  const [quantity, setQuantity] = useState(0);
  const [taxPercentage, setTaxPercentage] = useState(0);
  const [taxDollarAmount, setTaxDollarAmount] = useState(0);
  const [taxPercentageAmount, setTaxPercentageAmount] = useState(0);
  const [isTaxPercentage, setIsTaxPercentage] = useState(true);
  const [price, setPrice] = useState(0);
  const dispatch = useMembershipDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const { inventories } = useInventoryState()
  let {
    memberships,
    isMembershipLoading,
    purchasedMemberships,
    isPurchasedMembershipLoading,
  } = useMembershipState();


  useEffect(() => {
    actions.fetchPurchasedMemberships(dispatch);
  }, []);

  useEffect(() => {
    const memberships_issued = memberships
      .filter((membership_) => membership_.inventories.length > 0)
      .filter(
        (membership) =>
          membership.ownerOrganization ===
          membership.inventories[0].manufacturer
      );
    setPossibleMemberships(purchasedMemberships);
  }, [memberships, purchasedMemberships]);

  useEffect(() => {
    if (inventories.length > 0) {
      setInventoryId(inventories[0]?.address)
      setProductId(inventories[0]?.productId)
    }
  }, [inventories])

  const handleFormatter = (value) => {
    if (value === "" || value === ".") {
      return "0.00";
    }

    const decimalParts = value.toString().split(".");
    if (decimalParts.length === 1) {
      return `${decimalParts[0]}.00`;
    } else if (decimalParts[1].length === 1) {
      return `${decimalParts[0]}.${decimalParts[1]}0`;
    } else {
      return `${decimalParts[0]}.${decimalParts[1].substring(0, 2)}`;
    }
  };

  const handleParser = (value) => {
    // Remove non-numeric characters and leading zeros
    const numericValue = value.replace(/[^\d.-]/g, "");
    const parsedValue = parseFloat(numericValue).toFixed(2);
    return isNaN(parsedValue) ? "" : parsedValue;
  };

  const handleMembership = (value) => {
    let membership = purchasedMemberships.find((item) => item.itemNumber == value)

    inventoryActions.fetchInventory(inventoryDispatch, '', 0, productId);
    setProductId(membership.productId)
    setSelectedMembership(value);
    setId(value);
  }

  const selectAfter = (
    <Select
      defaultValue="1"
      onChange={(value) => {
        if (value === "1") {
          setIsTaxPercentage(true)
        }
        else if (value === "0") {
          setIsTaxPercentage(false)
        }
        // formik.setFieldValue("isTaxPercentage", value === "1");
      }}
      style={{ width: 60 }}
    >
      <Option value="0">$</Option>
      <Option value="1">%</Option>
    </Select>
  );

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
      render: () => (
        <Select
          style={{ width: 200 }}
          placeholder="Select a membership"
          suffixIcon={isPurchasedMembershipLoading ? <Spin /> : <CaretDownOutlined />}
          disabled={isPurchasedMembershipLoading}
          onChange={(value) => {
            handleMembership(value)
          }}
        >
          {possibleMemberships.map((membership, index) => (
            <Option key={index} value={membership.itemNumber}>
              {membership.productName}
            </Option>
          ))}
        </Select>
      )
    },
    {
      title: "Id",
      dataIndex: "id",
      key: "id",
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
    },
    {
      title: "Tax Percentage/Amount",
      dataIndex: "percentage",
      key: "precentage",
    },
    {
      title: "Price",
      dataIndex: "price",
      key: "price",
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
    },
  ];

  const data = [
    {
      key: "1",
      seller: seller,
      membership: selectedMembership,
      id: id,
      quantity: (
        <>
          <InputNumber
            id="quantity"
            name="quantity"
            controls={false}
            type="number"
            onWheel={(e) => e.target.blur()}
            min={0}
            value={quantity}
            onChange={(value) => {
              setQuantity(value);
            }}
          />
        </>
      ),
      percentage: (
        <>
          <InputNumber
            id="percentage"
            name="percentage"
            controls={false}
            type="number"
            onWheel={(e) => e.target.blur()}
            min={0}
            addonAfter={selectAfter}
            formatter={handleFormatter}
            parser={handleParser}
            value={taxPercentage}
            onChange={(value) => {
              //   formik.setFieldValue("taxPercentage", value);
              setTaxPercentage(value)
              isTaxPercentage
                ? setTaxPercentageAmount(value)//formik.setFieldValue("taxPercentageAmount", value)
                : setTaxDollarAmount(value) // formik.setFieldValue("taxDollarAmount", value);
              !isTaxPercentage
                ? setTaxPercentageAmount(0) //formik.setFieldValue("taxPercentageAmount", 0)
                : setTaxDollarAmount(0) //formik.setFieldValue("taxDollarAmount", 0);
            }}
          />
        </>
      ),
      price: (
        <>
          <InputNumber
            id="price"
            name="price"
            controls={false}
            type="number"
            onWheel={(e) => e.target.blur()}
            min={0}
            value={price}
            onChange={(value) => {
              setPrice(value)
            }}
          />
        </>
      ),
      type: possibleMemberships.find((membership) => membership.address === selectedMembership)
        ? "New"
        : "Sale"

    },
  ];

  const handleCreateFormSubmit = async () => {

    // const inventoryBody = {
    //   productAddress: productId,
    //   quantity: quantity,
    //   pricePerUnit: price,
    //   // Generate random code for now
    //   batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
    //   // Status should always be published if we use List Now
    //   status: INVENTORY_STATUS.PUBLISHED,
    //   serialNumber: [],
    //   taxPercentageAmount: taxPercentageAmount,
    //   taxDollarAmount: taxDollarAmount,
    // };

    // const createInventory = await inventoryActions.createInventory(
    //   inventoryDispatch,
    //   inventoryBody
    // );


    const updatePayload = {
      productAddress: productId,
      inventory: inventoryId,
      updates: {
        pricePerUnit: price,
        status: INVENTORY_STATUS.PUBLISHED,
        quantity: quantity
      }
    }

    const updateInventory = await inventoryActions.updateInventory(
      inventoryDispatch,
      updatePayload
    );



    if (updateInventory) {
      // membership.product_with_inventory = 1;
      setInventoryId('')
      setProductId('')
    }
    handleCancel();
  };

  return (
    <Modal
      style={{ maxWidth: "1300px" }}
      width="auto"
      title="Create Listing"
      open={open}
      onCancel={handleCancel}
      //   onOk={handleCreateFormSubmit()}
      footer={[
        <Button
          key="list-now"
          onClick={
            () => {
              handleCreateFormSubmit();
            }
          }
          loading={false}
          type="primary"
        >
          List Now
        </Button>,
      ]}
    >
      <Form>
        <Table columns={columns} dataSource={data} pagination={false}></Table>
      </Form>
    </Modal>
  );
};

export default ListNowIndex;
