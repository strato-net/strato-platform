import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { Card, Popover, Spin, Button, Row, Col, Typography, Image, Modal, Table, Collapse } from "antd";
import { MoreOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
// import DeleteProductModal from "./DeleteProductModal";
// import UpdateProductModal from "./UpdateProductModal";
import helperJson from "../../helpers/helper.json"
import "./membership.css";
import routes from "../../helpers/routes";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";
import dayjs from 'dayjs';
import ListNowModal from "../Membership/ListNowModal";
import * as yup from "yup";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { Carousel } from 'react-responsive-carousel';
import { forwardArrowIcon, tag, tagIcon } from "../../images/SVGComponents";
import noPreview from "../../images/resources/noPreview.jpg";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import { listNowConfig } from "../MarketPlace/listNowConfig";
const { purchasedCardColumn, statusColor, statusText } = helperJson;

const { Text, Paragraph, Title } = Typography;


const initialValues = {
  name: "",
  price: "",
  quantity: "",
  // isTaxPercentage:false,
};


const MembershipCardPurchased = ({
  user,
  membership,
  categorys,
  debouncedSearchTerm,
  membershipId,
  isPurchasedList
}) => {
  const inventoryDispatch = useInventoryDispatch();
  const membershipDispatch = useMembershipDispatch();
  const membershipState = useMembershipState()
  const { type } = useParams()
  const isIssued = type === "issued";
  const isPurchased = type === "purchased";
  const {
    subCategory,
    manufacturer,
    timePeriodInMonths,
    savings,
    // membershipId,
    expiryDate,
    availableQuantity,
    membershipAddress,
    inventoryId,
    Inventories,
    itemNumber,
    status,
    description,
    productImageLocation
  } = membership;

  const [isEdit, setIsEdit] = useState(false)
  const [state, setState] = useState(null);
  const [listModalConfig, setListModalConfig] = useState({})
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [carouselModel, setCarouselModel] = useState(false);
  const [listed, setListed] = useState(0)
  const navigate = useNavigate();
  const naviroute = routes.MembershipDetail.url;
  const [visible, setVisible] = useState(false);
  const [listType, setListType] = useState("Sale");
  const InventoriesLen = Inventories?.length > 0;

  const getSchema = (isListNowModalOpen) => {
    return yup.object().shape({
      name: yup.string().required("Membership name is required"),
      price: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Price is required"),
      }),
      quantity: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number(),
      }),
    });
  };


  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: getSchema(visible),
    setFieldValue: (field, value) => {
      formik.setFieldValue(field, value);
    },
    onSubmit: function (values) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });


  const updateCol = (inv, texts) => (<Row
    style={{ justifyContent: 'space-between' }}>
    <p>{texts} </p>
  </Row>)

  const callDetailPage = (index, address) => {
    let route;
    route = `/memberships/${type}/${membership.membershipAddress}?inventoryId=${membership.inventoryId}`
    navigate(route);
  }

  const previewCol = (inv, address) => (<Button type="text"
    className="text-primary text-sm cursor-pointer"
    // onClick={callDetailPage.bind(this, indx, address)}
    onClick={() => {
      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
        window.location.href = loginUrl;
      } else {
        let tax = inv.taxPercentageAmount || inv.taxDollarAmount;
        let isPercent = inv.taxDollarAmount === 0 ? true : false
        formik.setFieldValue("name", membership.productName);
        formik.setFieldValue("inventoryStatus", inv.status);
        formik.setFieldValue("tempInv", inv);
        formik.setFieldValue("inventoryID", inv.address);
        formik.setFieldValue("quantity", inv.availableQuantity);
        formik.setFieldValue("price", inv.pricePerUnit);
        formik.setFieldValue("taxPercentage", tax);
        formik.setFieldValue("isTaxPercentage", isPercent);
        formik.setFieldValue("taxPercentageAmount", inv.taxPercentageAmount);
        formik.setFieldValue("taxDollarAmount", inv.taxDollarAmount);
        formik.setFieldValue("taxPercentageAmount", inv.taxPercentageAmount);
        setIsEdit(true)
        openListNowModal("editInventory");
      }
    }}
  >
    <EditOutlined
    />
  </Button>)

  let data = Inventories?.map((inventory, index) => {
    return {
      key: index,
      name: inventory.block_timestamp,
      age: inventory.availableQuantity,
      published: updateCol(inventory, inventory.status === 1 ? "Published" : "Unpublished"),
      edit: previewCol(inventory, inventory.address),
      address: "$ " + String(inventory.pricePerUnit)
    }
  });

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { isCreateInventorySubmitting, inventories, success } = useInventoryState();

  useEffect(() => {
    setVisible(false);
    setState(membership);
    setIsEdit(false);
  }, [success, membershipState.success])

  const closeListNowModal = () => {
    setVisible(false);
    setIsEdit(false);
    setListType("Sale");
    setListed(0);
  };

  const openListNowModal = (configCase) => {
    setVisible(true);
    let config = listNowConfig(configCase);
    setListModalConfig(config);
  };

  const handleCreateFormSubmit = async (values) => {
    if (user) {
      if (formik.values.price !== "" && inventories) {
        if (isIssued) {
          let taxPercentageAmountValue = formik.values.taxPercentageAmount ?? 0;
          let taxDollarAmountValue = formik.values.taxDollarAmount ?? 0;
          const inventoryBody = {
            productAddress: membership.productId,
            quantity: formik.values.quantity,
            pricePerUnit: formik.values.price,
            // Generate random code for now
            batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
            // Status should always be published if we use List Now
            status: INVENTORY_STATUS.PUBLISHED,
            serialNumber: [],
            taxPercentageAmount: Math.floor(taxPercentageAmountValue),
            taxDollarAmount: Math.floor(taxDollarAmountValue),
          };
          if (isEdit) {
            const updatePayload = {
              productAddress: membership.productId,
              inventory: formik.values.inventoryID,
              updates: {
                pricePerUnit: formik.values.price,
                status: parseInt(formik.values.inventoryStatus),
                quantity: formik.values.quantity,
                taxPercentageAmount: parseInt(formik.values.taxPercentage),
                taxDollarAmount: parseInt(formik.values.taxDollarAmount)
              }
            }
            const updateInventory = await inventoryActions.updateInventory(
              inventoryDispatch,
              updatePayload
            )
            if (updateInventory) {
              formik.resetForm();
              // handleCancel("success");
            }
          } else {
            const createInventory = await inventoryActions.createInventory(
              inventoryDispatch,
              inventoryBody
            )
            if (createInventory) {
              formik.resetForm();
              // handleCancel("success");
            }
          }
        }
        else {
          const resalePayload = {
            itemAddress: membership.itemAddress,
            productAddress: membership.productId,
            inventory: membership.inventoryId,
            updates: {
              pricePerUnit: formik.values.price,
              status: formik.values.inventoryStatus,
              quantity: 1,
              taxPercentageAmount: formik.values.taxPercentageAmount,
              taxDollarAmount: formik.values.taxDollarAmount
            }
          }
          const resaleMembership = await membershipActions.resaleMembership(
            membershipDispatch, resalePayload
          )

          if (resaleMembership) {
            // membership.product_with_inventory = 1;
            formik.resetForm();
          }
          setVisible(false);
        }
      }
    }
  };

  // const renderCustomPrevArrow = (clickHandler, hasPrev, label) => (
  //   <button onClick={clickHandler} disabled={!hasPrev} className="custom-arrow .custom-prev-mem-carousel">
  //     Previous
  //   </button>
  // );

  // const renderCustomNextArrow = (clickHandler, hasNext, label) => (
  //   <button onClick={clickHandler} disabled={!hasNext} className="custom-arrow custom-next-mem-carousel">
  //     Next
  //   </button>
  // );

  const inventoriesCol = (Inventories && Inventories.length == 0) ? "red" : "green";

  return (
    <>
      {state === null ? (
        <div className="h-screen flex justify-center items-center">
          <Spin />
        </div>
      ) : (
        <Card className="w-full mt-6 border-grey card-shadow" id="product" key={membershipId}>
          <Col span={24} style={{ padding: "0px" }}>
            <Row className="p-4 flex justify-between item-center rounded-md" style={{ backgroundColor: "#f2f2f9" }}>
              <Col >
                <Row>
                  <Text level={4} className="font-poppin text-2xl lh-28">
                    {membership?.productName ?? "--"}
                    {/* {decodeURIComponent(membership?.productName)} */}
                  </Text>
                </Row>
                <Row strong className="lh-20" type={status == 1 ? 'success' : 'danger'} level={4}>
                  <Col className="m-tp-5 w-2.5 h-2.5 rounded-md" style={{
                    borderRadius: '10%', backgroundColor: `${(status && statusColor[status]) ?? inventoriesCol} `,
                  }} > </Col>
                  &nbsp; {statusText[status] ?? (Inventories?.length > 0 ? "For Sale" : "Not for Sale")}
                </Row>
              </Col>
              <Col className="text-right flex" style={{ alignItems: "center" }}>
                <Row type="text" onClick={() => { callDetailPage(null, inventoryId) }}>
                  <Text className="primary-theme-text font-bold text-sm leading-4 flex font-poppin cursor-pointer"> Preview  </Text>
                  <Text className="ml-2 m-tp-2"> {forwardArrowIcon()}</Text>
                </Row>
                {/* {isPurchased && <Row className="px-2">
                  <Button onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      let taxVal = membership.taxPercentageAmount === 0 ? membership.taxDollarAmount : membership.taxPercentageAmount;
                      let isTaxpercentage = membership.taxDollarAmount === 0;
                      formik.setFieldValue("name", membership.productName);
                      // formik.setFieldValue("quantity", membership.productName);
                      formik.setFieldValue("inventoryStatus", parseInt(membership.status));
                      formik.setFieldValue("isTaxPercentage", isTaxpercentage);
                      formik.setFieldValue("taxPercentage", taxVal);
                      formik.setFieldValue("price", membership.price);
                      formik.setFieldValue("taxPercentageAmount", membership.taxPercentageAmount);
                      formik.setFieldValue("taxDollarAmount", membership.taxDollarAmount);
                      if (status === '2') {
                        setListed(1)
                      } else {
                        setListed(2)
                      }
                      openListNowModal();
                    }
                  }} >
                    <Text className="primary-theme-text font-bold text-sm leading-4 flex font-poppin cursor-pointer"> Edit</Text>
                  </Button>
                </Row>} */}
              </Col>
              {!isPurchasedList &&
                (<Col span={24} className="mt-2">
                  <Text className="text-lg font-medium leading-6 font-poppin"> Description </Text>
                  <Paragraph
                    ellipsis={{ rows: 2, expandable: true, symbol: <Text strong>...more</Text> }}
                    className="text-sm mt-2 text-dark-grey font-normal leading-5 font-poppin">
                    {description}
                  </Paragraph>
                </Col>)}
            </Row>
            <Row className="mt-4">
              <Col sm={12} lg={12} xl={8} xxl={6} className="border-grey shadow-lg h-52 rounded overflow-hidden">
                {productImageLocation.length === 0 ?
                  <Image
                    className="object-covers"
                    width={'100%'}
                    height={'90%'}
                    preview={false}
                    fallback={noPreview}
                    src={productImageLocation[0]}
                  // src="https://zos.alipayobjects.com/rmsportal/jkjgkEfvpUPVyRjUImniVslZfWPnJuuZ.png"
                  />
                  :
                  <Carousel showArrows={true} showThumbs={false} className="h-full mem-card-carousel" >
                    {productImageLocation && productImageLocation?.map((item) => {
                      return <Image
                        key={item}
                        className="object-covers"
                        width={'100%'}
                        height={'100%'}
                        preview={false}
                        onClick={() => { setCarouselModel(true) }}
                        src={item}
                        fallback={noPreview}
                      // src={membership.productImageLocation}
                      />
                    })}
                  </Carousel>}

                {/* {(!membership.product_with_inventory && isPurchasedList) ? */}
                {availableQuantity == 0 ? "" : <Button
                  block={true}
                  className="text-white text-sm cursor-pointer absolute bottom-0 rounded-none flex sm:h-10 pt-2"
                  onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      let taxVal = membership.taxPercentageAmount === 0 ? membership.taxDollarAmount : membership.taxPercentageAmount;
                      let isPercent = membership.taxDollarAmount === 0 ? true : false
                      formik.setFieldValue("name", membership.productName);
                      formik.setFieldValue("inventoryStatus", membership.status);
                      formik.setFieldValue("isTaxPercentage", isPercent);
                      formik.setFieldValue("price", membership?.price);
                      formik.setFieldValue("quantity", isPurchased ? 1 : null);
                      formik.setFieldValue("taxPercentage", taxVal);
                      formik.setFieldValue("taxPercentageAmount", membership.taxPercentageAmount);
                      formik.setFieldValue("taxDollarAmount", membership.taxDollarAmount);
                      openListNowModal(isPurchased ? "resaleMembership" : "AddInventory");
                    }
                  }}
                  type={availableQuantity == 0 ? "default" : "primary"}
                  disabled={availableQuantity == 0 ? true : false}
                >
                  <Row className="mx-auto w-full text-sm font-semibold">
                    <Col className="w-28 mx-auto flex justify-between item-center">
                      <Text>{tagIcon()}</Text>
                      <Text className="text-white font-poppin">
                        &nbsp;
                        {isPurchased ? "Edit Listing" : "Add Inventory"}
                      </Text>
                    </Col>
                  </Row>
                </Button>}
                {/* : null} */}
              </Col>
              <Col sm={12} lg={{ span: 12 }} xl={{ span: 14, offset: 1 }} xxl={{ span: 17, offset: 1 }}
                className={`border-grey shadow-lg leading-2 min-h-min rounded p-4 ${isPurchasedList ? "h-52" : "h-40"}`}>
                <Paragraph >
                  <Text className="font-normal text-grey leading-5 font-poppin" >Sub Category</Text>
                  <Text className="float-right font-poppin leading-5">{subCategory ?? "--"}</Text>
                </Paragraph>
                <Paragraph >
                  <Text className="font-normal text-grey leading-5 font-poppin" >Company Name</Text>
                  <Text className="float-right font-poppin leading-5">{manufacturer ?? "--"}</Text>
                </Paragraph>
                {isIssued
                  ? <Paragraph >
                    <Text className="font-normal text-grey leading-5 font-poppin" >Duration</Text>
                    <Text className="float-right font-poppin leading-5">{timePeriodInMonths ?? "--"} Month(s)</Text>
                  </Paragraph>
                  : <Paragraph >
                    <Text className="font-normal text-grey leading-5 font-poppin" >Expiry Date</Text>
                    <Text className="float-right font-poppin leading-5">{dayjs(expiryDate).format('MM-DD-YYYY') ?? "--"}</Text>
                  </Paragraph>}
                <Paragraph >
                  <Text className="font-normal text-grey leading-5 font-poppin" >Savings</Text>
                  <Text type="success" className="float-right font-poppin leading-5">$ {savings ?? 0}</Text>
                </Paragraph>
                {membershipId && isPurchasedList && <Paragraph>
                  <Text className="font-normal text-grey leading-5 font-poppin" >Membership Number</Text>
                  <Text className="float-right font-poppin leading-5">{membershipId ?? "--"}</Text>
                </Paragraph>}
              </Col>
            </Row>
            {Inventories && Inventories?.length > 0 &&
              <Row className="mt-4">
                <Col span={24}>
                  {/* <Title level={5}>Inventories</Title> */}
                  {/* <Collapse
                    size="large"
                    items={[{ key: '1', label: 'This is default size panel header', children: <Table bordered pagination={false} columns={columns} dataSource={data} /> }]}
                  /> */}
                  <Collapse size="large" expandIconPosition='end'>
                    <Collapse.Panel key="1" header={<Title className="leading-6 text-lg font-poppin font-medium" level={5}>Inventories</Title>}>
                      <Table pagination={false}
                        className="inventory-table"
                        rowClassName={"bg-white"} rowKey="key" columns={purchasedCardColumn} dataSource={data} />
                    </Collapse.Panel>
                  </Collapse>
                </Col>
              </Row>}
          </Col>

          {/* {open && (
            <DeleteProductModal
              open={open}
              handleCancel={handleCancel}
              product={state}
              debouncedSearchTerm={debouncedSearchTerm}
            />
          )}
          {editModalOpen && (
            <UpdateProductModal
              open={editModalOpen}
              handleCancel={handleEditModalClose}
              productToUpdate={state}
              categorys={categorys}
              debouncedSearchTerm={debouncedSearchTerm}
            />
          )} */}
        </Card>
      )}
      {visible && (
        <ListNowModal
          config={listModalConfig}
          open={visible}
          user={user}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          id={itemNumber}
          membershipStatus={membership.status}
          getIn={getIn}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}

      <Modal
        title={<Text className="h-44"> &nbsp;</Text>}
        centered
        open={carouselModel}
        closeIcon={false}
        footer={null}
        onOk={() => setCarouselModel(false)}
        onCancel={() => setCarouselModel(false)}
        width={1100}
        className="gallary-modal"
      // height={'100%'}
      >
        <Row>
          <Col span={16} className="mx-auto ">
            <Carousel showArrows={true} showThumbs={false}
            // renderArrowPrev={renderCustomPrevArrow}
            // renderArrowNext={renderCustomNextArrow}
            >
              {productImageLocation && productImageLocation?.map((item) => {
                return <Image
                  key={item}
                  className="object-covers"
                  width={'100%'}
                  // height={390}
                  preview={false}
                  onClick={() => { setCarouselModel(true) }}
                  src={item}
                  fallback={noPreview}
                // src={membership.productImageLocation}
                />
              })}
            </Carousel>
          </Col>
        </Row>
      </Modal>

    </>
  );
};

export default MembershipCardPurchased;
