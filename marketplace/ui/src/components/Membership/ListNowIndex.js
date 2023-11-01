import React, { useState, useEffect } from "react";
import { Form, Modal, InputNumber, Button, Spin, Select, Table, Typography, Row, Col, Input } from "antd";
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
import { useParams } from "react-router-dom";
const { columns, taxOptions } = helperJson;
const { Text, Title } = Typography;

let MAX_QUANTITY = null;

const ListNowIndex = ({
  open,
  handleCancel,
  user,
  isSellModal
  //   formik,
  // type,
  // tab
  //   getIn,
  //   isCreateMembershipSubmitting,
}) => {
  const { type } = useParams();
  const isIssued = type === 'issued';
  const isPurchased = type === 'purchased';

  const { inventories, isInventoriesLoading, isCreateInventorySubmitting } = useInventoryState();
  const [availableQuantity, setAvailableQuantity] = useState('');
  // const inventoryQuantity = type == 'Resale' ? availableQuantity : 99999;
  const seller = user.user.organization;
  const { cartList } = useMarketplaceState();
  const [purchasedMembershipData, setPurchasedMembershipData] = useState([]);
  const [memebershipList, setMemebershipList] = useState([]);
  const [error, setError] = useState('');
  const [productId, setProductId] = useState('')
  const [id, setId] = useState("");
  const [membershipNumber, setMembershipNumber] = useState((isIssued || isSellModal) ? 'None' : '')
  const [inventoryId, setInventoryId] = useState('')
  const [quantity, setQuantity] = useState(1);
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
    isMembershipsLoading,
    isResaleMembershipSubmitting,
    purchasedMemberships,
    isPurchasedMembershipLoading,
  } = useMembershipState();

  function transformData(data) {
    const uniqueMembership = {};
    const resultArray = [];

    data.forEach((item) => {
      const productId = item.productId;
      let productName;
      if (isIssued || isSellModal) {
        productName = item.product.name;
      } else {
        productName = item.productName;
      }

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
    let purchasedList = purchasedMemberships.filter((item) => item.availableQuantity != 0);
    let issuedList = memberships.filter((item) => item?.inventories?.length == 0);
    transformData((isIssued || isSellModal) ? issuedList : purchasedList);
  }, [memberships, purchasedMemberships]);

  // useEffect(() => {
  //   if (inventories.length > 0) {
  //     setInventoryId(inventories.map((item) => item.address));
  //     setProductId(inventories[0]?.productId);
  //     MAX_QUANTITY = inventories[0].availableQuantity;
  //   }
  // }, [inventories])


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
    setMembershipNumber('');
    setQuantity(1);
    setProductId(value);

    let idList
    if (isIssued || isSellModal) {
      setProductId(value)
    } else {
      idList = purchasedMemberships.filter((item) => item.productId == value).map((item) => ({ value: item.itemAddress, label: item.itemNumber, inventoryId: item.inventoryId, availableQuantity: item.availableQuantity }))
    }
    // let membership = purchasedMemberships.filter((item) => item.productId == value).map((item) => ({ value: item.itemAddress, label: item.itemNumber }))
    setMemebershipList(idList)
    // inventoryActions.fetchInventory(inventoryDispatch, '', 0, value);
  }

  const handleCreateFormSubmit = async () => {
    if (isIssued || isSellModal) {
      const inventoryBody = {
        productAddress: productId,
        quantity: quantity,
        pricePerUnit: price,
        // Generate random code for now
        batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
        // Status should always be published if we use List Now
        status: INVENTORY_STATUS.PUBLISHED,
        serialNumber: [],
        taxPercentageAmount: Math.floor(taxPercentageAmount * 100),
        taxDollarAmount: Math.floor(taxDollarAmount * 100),
      };
      const createInventory = await inventoryActions.createInventory(
        inventoryDispatch,
        inventoryBody
      );
    } else {
      const resalePayload = {
        itemAddress: id,
        productAddress: productId,
        inventory: inventoryId,
        updates: {
          pricePerUnit: price,
          status: INVENTORY_STATUS.PUBLISHED,
          quantity: 1,
          taxPercentageAmount: Math.floor(taxPercentageAmount * 100),
          taxDollarAmount: Math.floor(taxDollarAmount * 100),
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
    }
  };

  const membershipType = purchasedMembershipData.find((membership) => membership.address === id)
    ? "New"
    : "Sale"

  const selectSuffix = isPurchasedMembershipLoading ? <Spin /> : <CaretDownOutlined />
  const isMembershipDropDown = (isPurchasedMembershipLoading || isMembershipsLoading);
  return (
    <Modal
      style={{ maxWidth: "720px" }}
      width="auto"
      title={<Text className="text-xl font-semibold">Create Listing</Text>}
      open={open}
      onCancel={handleCancel}
      footer={[
        <Row>
          <Button
            key="list-now"
            className="mx-auto w-52 mt-10 font-bold"
            size="large"
            disabled={(isListNow || isResaleMembershipSubmitting) && (!isIssued && !isSellModal)}
            loading={isResaleMembershipSubmitting || isCreateInventorySubmitting}
            onClick={() => { handleCreateFormSubmit() }}
            type={(isListNow || isResaleMembershipSubmitting) && (!isIssued && !isSellModal) ? 'default' : 'primary'}
          >
            List Now
          </Button>
        </Row>
      ]}
    >
      <hr style={{ color: '#e6d8d8', marginTop: '5px' }} />
      <Form className="mt-10">
        <Row gutter={[48, 12]}>
          <Col span={8}>
            <Row> <Text className="font-medium">Seller</Text> </Row>
            <Row><Input type="text" value={seller} size="large" disabled={true} className="cursor-not-allowed mt-2 h-12" /> </Row>
          </Col>
          <Col span={8} >
            <Row><Text className="font-medium">Membership</Text> </Row>
            <Row> <Select
              className="w-full mt-2"
              size="large"
              // placeholder="Membership"
              suffixIcon={isMembershipDropDown ? <Spin /> : selectSuffix}
              disabled={isMembershipDropDown}
              onChange={(value) => {
                handleMembership(value)
              }}
              options={purchasedMembershipData}
            /> </Row>
          </Col>
          {isPurchased && <Col span={8}>
            <Row> <Text className="font-medium">Membership Number</Text></Row>
            <Row><Select
              className="w-full mt-2"
              size="large"
              // placeholder="Membership Id"
              value={membershipNumber}
              suffixIcon={selectSuffix}
              disabled={isPurchasedMembershipLoading || (isIssued || isSellModal)}
              onChange={(value, obj) => {
                setMembershipNumber(obj.label)
                setInventoryId(obj.inventoryId)
                setId(value)
                setAvailableQuantity(obj.availableQuantity)
              }}
              options={memebershipList}
            /></Row>
          </Col>}
          <Col span={8}>
            <Row> <Text className="font-medium">Quantity</Text></Row>
            <Row><InputNumber
              id="quantity"
              name="quantity"
              size="large"
              controls={false}
              type="number"
              className="w-full mt-2"
              // placeholder="Quantity"
              prefix={isInventoriesLoading && <Spin />}
              onWheel={(e) => e.target.blur()}
              disabled={true && !isIssued}
              min={0}
              max={MAX_QUANTITY}
              value={quantity}
              onChange={(value) => {
                setError('');
                setQuantity(value);
              }}
            /> </Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">Tax Percentage/Amount</Text></Row>
            <Row> <InputNumber
              id="percentage"
              name="percentage"
              addonAfter={<Row className="flex w-16 h-8 border-grey rounded-md justify-between cursor-pointer">
                <Col span={12} className="p-1" style={{ backgroundColor: isTaxPercentage ? "#F2F2F5" : "" }} onClick={() => { setIsTaxPercentage(true) }}>
                  %
                </Col>
                <Col span={12} className="p-1" style={{ backgroundColor: !isTaxPercentage ? "#F2F2F5" : "" }} onClick={() => { setIsTaxPercentage(false) }}>
                  $
                </Col>
              </Row>}
              className="w-full mt-2 h-12 addon-custom"
              // className="w-full mt-2 discount-btn"
              size="large"
              controls={false}
              type="number"
              // placeholder="Percentage"
              onWheel={(e) => e.target.blur()}
              min={0}
              step={1}
              // addonAfter={selectAfter}
              // formatter={handleFormatter}
              // parser={handleParser}
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
            /></Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">Price</Text></Row>
            <Row>
              <InputNumber
                addonBefore="$"
                className="w-full mt-2 h-12"
                size="large"
                id="price"
                name="price"
                controls={false}
                type="number"
                precision={0}
                // placeholder="Price"
                onWheel={(e) => e.target.blur()}
                min={0}
                value={price}
                onChange={(value) => {
                  setPrice(value)
                }}
              />
            </Row>
          </Col>
          {isPurchased && <Col span={8}>
            <Row> <Text className="font-medium">Type</Text></Row>
            <Row><Input type="text" value={(isIssued || isSellModal) ? 'New' : 'Sale'} size="large" disabled={true} className="cursor-not-allowed mt-2 h-12" /> </Row>
          </Col>}
        </Row>
      </Form >
    </Modal >
  );
};

export default ListNowIndex;
