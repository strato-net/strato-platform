import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Carousel } from 'react-responsive-carousel';
import { useFormik, getIn } from "formik";
import * as yup from "yup";
import dayjs from 'dayjs';
import { Card, Button, Row, Col, Typography, Image, Modal, Table, Collapse } from "antd";
import { EditOutlined } from "@ant-design/icons";
// Components
import ListNowModal from "./ListNowModal";
import ParagraphEllipsis from "../Ellipsis/ParagraphEllipsis"
// import routes from "../../helpers/routes";
// Actions
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
// Dispatch and States
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useAuthenticateState } from "../../contexts/authentication";
// Images, Icons, css, configs, 
import helperJson from "../../helpers/helper.json"
import noPreview from "../../images/resources/noPreview.jpg";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { listNowConfig } from "../MarketPlace/listNowConfig";
import { forwardArrowIcon, tagIcon } from "../../images/SVGComponents";
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import "./membership.css";
import LoaderComponent from "../Loader/LoaderComponent";

const { purchasedCardColumn, statusColor, statusText } = helperJson;
const { Panel } = Collapse;
const { Text, Paragraph, Title } = Typography;

const initialValues = {
  name: "",
  price: "",
  quantity: "",
  // isTaxPercentage:false,
};

const MembershipCard = ({
  user,
  membership,
  // debouncedSearchTerm,
  membershipId,
  cardConfig: {
    isDuration,
    issued,
    qty,
    isMembershipNumber,
    isDescription,
    configCase,
    btnName
  }
}) => {
  const inventoryDispatch = useInventoryDispatch();
  const membershipDispatch = useMembershipDispatch();
  const membershipState = useMembershipState();
  const { type } = useParams();
  // const isIssued = type === "issued";
  // const isPurchased = type === "purchased";
  const {
    subCategory,
    manufacturer,
    timePeriodInMonths,
    savings,
    // membershipId,
    expiryDate,
    availableQuantity,
    // membershipAddress,
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
  const [carouselModel, setCarouselModel] = useState(false);
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

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
        formik.setFieldValue("price", inv.pricePerUnit);
        formik.setFieldValue("quantity", inv.availableQuantity);
        formik.setFieldValue("taxPercentage", tax);
        formik.setFieldValue("isTaxPercentage", isPercent);
        formik.setFieldValue("taxPercentageAmount", inv.taxPercentageAmount);
        formik.setFieldValue("taxDollarAmount", inv.taxDollarAmount);
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
  };

  const openListNowModal = (configCase) => {
    setVisible(true);
    let config = listNowConfig(configCase);
    setListModalConfig(config);
  };

  const handleCreateFormSubmit = async (values) => {
    if (user) {
      if (formik.values.price !== "" && inventories) {
        if (issued) {
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
              inventory: formik.values.tempInv.address,
              updates: {
                pricePerUnit: formik.values.price,
                status: parseInt(formik.values.inventoryStatus),
                quantity: formik.values.quantity,
                taxPercentageAmount: parseInt(formik.values.taxPercentageAmount),
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

  const inventoriesCol = (Inventories && Inventories.length === 0) ? "red" : "green";
  const cardDetail = [
    { label: "Sub Category", value: subCategory, visible: true },
    { label: "Company Name", value: manufacturer, visible: true },
    {
      label: isDuration ? "Duration" : "Expiry Date", value: isDuration
        ? `${timePeriodInMonths ?? "--"} Month(s)`
        : `${dayjs(expiryDate).format('MM-DD-YYYY') ?? "--"}`, visible: true
    },
    { label: "Savings", value: `$ ${savings ?? 0}`, visible: true },
    { label: "Membership Number", value: membershipId, visible: isMembershipNumber },
  ]

  return (
    <>
      {state === null ? (
        <LoaderComponent />
      ) : (
        <Card className="w-full mt-6 border-grey card-shadow" id="product" key={membershipId}>
          <Col span={24} style={{ padding: "0px" }}>
            <Row className="p-4 flex justify-between item-center rounded-md" style={{ backgroundColor: "#f2f2f9" }}>
              <Col >
                <Row>
                  <Text level={4} className="font-poppin text-2xl lh-28">
                    {membership?.productName ?? "--"}
                  </Text>
                </Row>
                <Row className="lh-20" type={status === 1 ? 'success' : 'danger'} level={4}>
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
              </Col>
              {isDescription &&
                (<Col span={24} className="mt-2">
                  <Text className="text-lg font-medium leading-6 font-poppin"> Description </Text>
                  <ParagraphEllipsis description={description} className="text-dark-grey font-poppin" />
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
                      />
                    })}
                  </Carousel>}

                {availableQuantity === 0 ? "" : <Button
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
                      formik.setFieldValue("quantity", qty);
                      formik.setFieldValue("taxPercentage", taxVal);
                      formik.setFieldValue("taxPercentageAmount", membership.taxPercentageAmount);
                      formik.setFieldValue("taxDollarAmount", membership.taxDollarAmount);
                      openListNowModal(configCase);
                    }
                  }}
                  type={availableQuantity === 0 ? "default" : "primary"}
                  disabled={availableQuantity === 0 ? true : false}
                >
                  <Row className="mx-auto w-full text-sm font-semibold">
                    <Col className="w-28 mx-auto flex justify-between item-center">
                      <Text>{tagIcon()}</Text>
                      <Text className="text-white font-poppin">
                        &nbsp;
                        {btnName}
                      </Text>
                    </Col>
                  </Row>
                </Button>}
              </Col>
              <Col sm={12} lg={{ span: 12 }} xl={{ span: 14, offset: 1 }} xxl={{ span: 17, offset: 1 }}
                className={`border-grey shadow-lg leading-2 min-h-min rounded p-4 ${isMembershipNumber ? "h-52" : "h-40"}`}>
                {cardDetail.map(({ label, value, visible }, index) => {
                  return (visible && <Paragraph key={index}>
                    <Text className="font-normal text-grey leading-5 font-poppin" >{label}</Text>
                    <Text className="float-right font-poppin leading-5">{value ?? "--"}</Text>
                  </Paragraph>)
                })}
              </Col>
            </Row>
            {Inventories && Inventories?.length > 0 &&
              <Row className="mt-4">
                <Col span={24}>
                  <Collapse size="large" expandIconPosition='end'>
                    <Panel header={<Title className="leading-6 text-lg font-poppin font-medium" level={5}>Inventories</Title>} key="1" >
                      <Table pagination={false}
                        className="inventory-table"
                        rowClassName={"bg-white"} rowKey="key" columns={purchasedCardColumn} dataSource={data} />
                    </Panel>
                  </Collapse>
                </Col>
              </Row>}
          </Col>
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
      >
        <Row>
          <Col span={16} className="mx-auto ">
            <Carousel showArrows={true} showThumbs={false}>
              {productImageLocation && productImageLocation?.map((item) => {
                return <Image
                  key={item}
                  className="object-covers"
                  width={'100%'}
                  preview={false}
                  onClick={() => { setCarouselModel(true) }}
                  src={item}
                  fallback={noPreview}
                />
              })}
            </Carousel>
          </Col>
        </Row>
      </Modal>

    </>
  );
};

export default MembershipCard;
