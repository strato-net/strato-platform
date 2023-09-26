import React, { useState, useEffect } from "react";
import { Form, Modal, InputNumber, Button, Spin, Select, Table } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { actions as inventoryActions} from "../../contexts/inventory/actions";
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
  const [id, setId] = useState("select a membership");
  const [quantity, setQuantity] = useState(0);
  const [taxPercentage, setTaxPercentage] = useState(0);
  const [taxDollarAmount, setTaxDollarAmount] = useState(0);
  const [taxPercentageAmount, setTaxPercentageAmount] = useState(0);
  const [isTaxPercentage, setIsTaxPercentage] = useState(true);
  const [price, setPrice] = useState(0);
  const dispatch = useMembershipDispatch();
  const inventoryDispatch = useInventoryDispatch();
  let {
    memberships,
    ismembershipsLoading,
    purchasedMemberships,
    isPurchasedMembershipLoading,
  } = useMembershipState();

  useEffect(() => {
    actions.fetchMembership(dispatch);
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
    setPossibleMemberships(memberships_issued.concat(purchasedMemberships));
    console.log("possibleMemberships", possibleMemberships);
  }, [memberships, purchasedMemberships]);

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

  const selectAfter = (
    <Select
      defaultValue="1"
      onChange={(value) => {
        console.log("value",value)
        if (value === "1"){
            setIsTaxPercentage(true)
            console.log("isTaxPercentage1", isTaxPercentage)
        }
        else if (value === "0"){
            setIsTaxPercentage(false)
            console.log("isTaxPercentage2", isTaxPercentage)
        }
        // formik.setFieldValue("isTaxPercentage", value === "1");
        console.log("isTaxPercentage", isTaxPercentage)
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
          onChange={(value) => {
            setSelectedMembership(value);
            setId(value);
          }}
          value={selectedMembership}
        >
          {possibleMemberships.map((membership, index) => (
            <Option key={index} value={ membership.productName ? membership.membershipAddress : membership.address }>
              {membership.productName || membership.product.name}
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
    let selectedMembershipObject = possibleMemberships.find(
        (membership) => membership.address === selectedMembership
      );
      
    selectedMembershipObject = selectedMembershipObject
    ? selectedMembershipObject
    : possibleMemberships.find(
        (membership) => membership.membershipAddress === selectedMembership
        );
        
        
    const inventoryBody = {
      productAddress: selectedMembershipObject.productId,
      quantity: quantity,
      pricePerUnit: price,
      // Generate random code for now
      batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
      // Status should always be published if we use List Now
      status: INVENTORY_STATUS.PUBLISHED,
      serialNumber: [],
      taxPercentageAmount: taxPercentageAmount,
      taxDollarAmount: taxDollarAmount,
    };
    console.log(inventoryBody)
    const createInventory = await inventoryActions.createInventory(
      inventoryDispatch,
      inventoryBody
    );

    if (createInventory) {
      // membership.product_with_inventory = 1;
      console.log("Great success!")
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
                console.log('Excusi?');
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
