import React, { useState, useEffect } from "react";
import { Form, Modal, InputNumber, Button, Spin, Select, Table, Typography } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { CaretDownOutlined } from "@ant-design/icons"
import { INVENTORY_STATUS } from "../../helpers/constants";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as membershipActions } from "../../contexts/membership/actions"
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useMarketplaceState } from "../../contexts/marketplace";
import helperJson from "../../helpers/helper.json"
const { columns, taxOptions } = helperJson;

let MAX_QUANTITY = null;

const ListNowIndex = ({
  open,
  handleCancel,
  user,
  //   formik,
  type,
  //   getIn,
  //   isCreateMembershipSubmitting,
}) => {

  const { inventories, isInventoriesLoading } = useInventoryState()
  const inventoryQuantity = type == 'Resale' ? inventories[0]?.availableQuantity : 99999;
  const seller = user.user.organization;
  const { cartList } = useMarketplaceState();
  const [purchasedMembershipData, setPurchasedMembershipData] = useState([]);
  const [memebershipList, setMemebershipList] = useState([]);
  const [error, setError] = useState('');
  const [productId, setProductId] = useState('')
  const [id, setId] = useState("");
  const [membershipNumber, setMembershipNumber] = useState('')
  const [inventoryId, setInventoryId] = useState('')
  const [quantity, setQuantity] = useState('');
  const [taxPercentage, setTaxPercentage] = useState('');
  const [taxDollarAmount, setTaxDollarAmount] = useState(0);
  const [taxPercentageAmount, setTaxPercentageAmount] = useState(0);
  const [isTaxPercentage, setIsTaxPercentage] = useState(true);
  const [price, setPrice] = useState('');
  const membershipDispatch = useMembershipDispatch();
  const inventoryDispatch = useInventoryDispatch();

  const isListNow = (!productId || !id || !inventoryId || !quantity || !price);

  let {
    memberships,
    isMembershipLoading,
    isResaleMembershipSubmitting,
    purchasedMemberships,
    isPurchasedMembershipLoading,
  } = useMembershipState();

  function transformData(data) {
    const uniqueMembership = {};
    const resultArray = [];

    data.forEach((item) => {
      const productId = item.productId;
      const productName = item.productName;

      if (!uniqueMembership[productId]) {
        uniqueMembership[productId] = true; // Mark this product ID as seen
        resultArray.push({ value: productId, label: productName });
      }
    });

    setPurchasedMembershipData(resultArray)
    // return resultArray;
  }

  useEffect(() => {
    // setPurchasedMembershipData(purchasedMemberships);
    transformData(purchasedMemberships)
  }, [memberships, purchasedMemberships]);

  useEffect(() => {
    if (inventories.length > 0) {
      setInventoryId(inventories.map((item) => item.address));
      setProductId(inventories[0]?.productId);
      MAX_QUANTITY = inventories[0].availableQuantity;
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
    setMembershipNumber('')
    setQuantity('')
    setProductId(value)
    // let membership = purchasedMemberships.filter((item) => item.productId == value).map((item) => ({ value: item.itemAddress, label: item.itemNumber }))
    setMemebershipList(purchasedMemberships.filter((item) => item.productId == value).map((item) => ({ value: item.itemAddress, label: item.itemNumber })))
    inventoryActions.fetchInventory(inventoryDispatch, '', 0, value);
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
      options={taxOptions}
    />
  );


  const data = [
    {
      key: "1",
      seller: seller,
      membership: <Select
        style={{ width: 200 }}
        placeholder="Membership"
        suffixIcon={isPurchasedMembershipLoading ? <Spin /> : <CaretDownOutlined />}
        disabled={isPurchasedMembershipLoading}
        onChange={(value) => {
          handleMembership(value)
        }}
        options={purchasedMembershipData}
      />
      ,
      id: <Select
        style={{ width: 200 }}
        placeholder="Membership Id"
        value={membershipNumber}
        suffixIcon={isPurchasedMembershipLoading ? <Spin /> : <CaretDownOutlined />}
        disabled={isPurchasedMembershipLoading}
        onChange={(value, obj) => {
          setMembershipNumber(obj.label)
          setId(value)
        }}
        options={memebershipList}
      />
      ,
      quantity: (
        <>
          <InputNumber
            id="quantity"
            name="quantity"
            controls={false}
            type="number"
            placeholder="Quantity"
            prefix={isInventoriesLoading && <Spin />}
            onWheel={(e) => e.target.blur()}
            disabled={isInventoriesLoading || productId == ''}
            min={0}
            max={MAX_QUANTITY}
            value={quantity}
            onChange={(value) => {
              if (value > MAX_QUANTITY) {
                setError(`Quantity cannot exceed ${MAX_QUANTITY}`);
              } else {
                setError('');
                setQuantity(value);
              }
            }}
          />
          {type === "Resale" && inventoryId != '' && <p>Available: {inventoryQuantity}</p>}
          {error && <div style={{ color: 'red' }}>{error}</div>}
        </>
      ),
      percentage: (
        <InputNumber
          id="percentage"
          name="percentage"
          controls={false}
          type="number"
          placeholder="Percentage"
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
      ),
      price: (
        <InputNumber
          id="price"
          name="price"
          controls={false}
          type="number"
          placeholder="Price"
          onWheel={(e) => e.target.blur()}
          min={0}
          value={price}
          onChange={(value) => {
            setPrice(value)
          }}
        />
      ),
      type: purchasedMembershipData.find((membership) => membership.address === id)
        ? "New"
        : "Sale"

    },
  ];

  const handleCreateFormSubmit = async () => {
    const resalePayload = {
      productAddress: productId,
      inventory: inventoryId,
      updates: {
        pricePerUnit: price,
        status: INVENTORY_STATUS.PUBLISHED,
        quantity: 1
      }
    }

    const resaleMembership = await membershipActions.resaleMembership(
      membershipDispatch, resalePayload
    )

    if (resaleMembership) {
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
      footer={[
        <Button
          key="list-now"
          disabled={isListNow || isResaleMembershipSubmitting}
          loading={isResaleMembershipSubmitting}
          onClick={
            () => {
              handleCreateFormSubmit();
            }
          }
          type="primary"
        >
          List Now
        </Button>,
      ]}
    >
      <Form>
        <Table columns={columns} dataSource={data} pagination={false} />
      </Form>
    </Modal>
  );
};

export default ListNowIndex;
