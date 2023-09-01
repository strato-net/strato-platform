import React, { useEffect, useState } from "react";
import {
  Spin,
  Typography,
  Tabs,
  Col,
  Row,
  notification,
  Button,
  Space,
  Modal,
} from "antd";
import ImageCollage from "../../Carousel/ImageCollage";
import OverviewTab from "./ListingTabs/OverviewTab";
import FeaturesTab from "./ListingTabs/FeaturesTab";
import PriceHistoryTab from "./ListingTabs/PriceHistoryTab";
import ReviewTab from "./ListingTabs/ReviewTab";
import { useParams } from "react-router-dom";
import { EditOutlined, UploadOutlined } from "@ant-design/icons"
import { actions } from "../../../contexts/propertyContext/actions";
import {
  usePropertiesDispatch,
  usePropertiesState,
} from "../../../contexts/propertyContext";
import TagManager from "react-gtm-module";
import UploadPhotosModal from "../../Product/UploadPhotosModal";
import { categoriesObj, homeTypeData } from "../helpers/constants";
import PropertyCreateModal from "./PropertyCreateModal";
import { useAuthenticateState } from "../../../contexts/authentication";
import TalkToSalesModal from "./TalkToSalesModal";

function PropertyDetails() {
  const [isUploadPhotosModalOpen, setUploadPhotosModal] = useState(false);
  const [isCreateModalOpen, toggleCreateModal] = useState(false);
  const [isTalkToSalesModalOpen, setTalkToSalesModal] = useState(false);
  const dispatch = usePropertiesDispatch();
  const {
    property,
    propertyDetails,
    isPropertyDetailsLoading,
    message,
    success,
  } = usePropertiesState();
  const { user } = useAuthenticateState();
  const organization = user?.organization

  let { id } = useParams();

  const handleCancel = () => {
    setTalkToSalesModal(!isTalkToSalesModalOpen);
  };

  useEffect(() => {
    actions.fetchPropertyDetails(dispatch, id);
  }, []);

  useEffect(() => {
    document.title = `Mercata Properties | ${propertyDetails?.title} `;
  }, [propertyDetails]);

  const { Text, Title } = Typography;

  const [api, contextHolder] = notification.useNotification();

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  // const images = [
  //   "https://images.pexels.com/photos/186077/pexels-photo-186077.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  //   "https://images.pexels.com/photos/1732414/pexels-photo-1732414.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  //   "https://images.pexels.com/photos/106399/pexels-photo-106399.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  //   "https://images.pexels.com/photos/3935328/pexels-photo-3935328.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  //   "https://images.pexels.com/photos/8894808/pexels-photo-8894808.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  //   "https://images.pexels.com/photos/13008560/pexels-photo-13008560.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1"
  // ]

  const {
    reviews,
    postalCity,
    postalcode,
    stateOrProvince,
    description,
    lotSizeArea,
    lotSizeUnits,
    listPrice,
    livingArea,
    livingAreaUnits,
    propertyType,
    unitNumber,
    bedroomsTotal,
    bathroomsTotalInteger,
    standardStatus,
    numberOfUnitsTotal,
    images
  } = propertyDetails || {};

  const getSelectedCategories = () => {
    const selectedCategories = {};

    for (const key in propertyDetails) {
      if (propertyDetails[key] === true) {
        for (const category in categoriesObj) {
          const categoryValues = categoriesObj[category].map(
            (item) => item.value
          );

          if (categoryValues.includes(key)) {
            if (!selectedCategories[category]) {
              selectedCategories[category] = [];
            }

            const label = categoriesObj[category].find(
              (item) => item.value === key
            ).label;
            selectedCategories[category].push(label);
          }
        }
      }
    }

    return selectedCategories;
  };

  const tabs = [
    {
      key: "Overview",
      label: `Overview`,
      children: <OverviewTab description={description} />,
    },
    {
      key: "Features",
      label: `Features`,
      children: <FeaturesTab property={property?.fields} />,
    },
    {
      key: "Price",
      label: `Price and Tax History`,
      children: <PriceHistoryTab property={property?.fields} />,
    },
    {
      key: "Reviews",
      label: `Reviews`,
      children: <ReviewTab reviews={propertyDetails?.reviews} propertyId={propertyDetails?.address} productId={propertyDetails?.productId} />,
    },
  ];

  const getFormattedResults = (selectedCategories) => {
    const formattedResults = {};

    for (const category in selectedCategories) {
      const formattedCategory = category
        .replace(/_/g, " ")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      const valuesArray = selectedCategories[category].map((value) => value);
      const formattedValues = valuesArray.join(", ");

      formattedResults[formattedCategory] = formattedValues;
    }

    return formattedResults;
  };

  const formattedResults = getFormattedResults(getSelectedCategories());

  const dataNotFound = () => {
    return (
      <div className="h-96 flex justify-center items-center" id="product-list">
        No property detail available
      </div>
    )
  }

  const editBox = () => {
    return (
      <Row
        wrap
        gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}
        className="mt-5 justify-between"
      >
        <>
          <Typography.Title
            level={4}
            style={{ padding: "0px 16px" }}
          ></Typography.Title>
          <Col style={{ marginRight: "50px" }}>
            <Button
              type="primary"
              onClick={() => {
                toggleCreateModal(true);
                TagManager.dataLayer({
                  dataLayer: {
                    event: "PROPERTIES_EDIT_PROPERTY_CLICK",
                  },
                });
              }}
              style={{ marginLeft: "5px" }}
            >
              <EditOutlined />
              Edit
            </Button>
          </Col>
        </>
      </Row>
    )
  }

  console.log(propertyDetails)
  return (
    <>
      {contextHolder}
      {message && openToast("bottom")}
      {!isPropertyDetailsLoading
        && propertyDetails?.organization == organization
        && editBox()
      }
      {isPropertyDetailsLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={isPropertyDetailsLoading} size="large" />
        </div>
      ) : (
        propertyDetails
          ? <Col span={22} style={{ margin: "auto", marginBottom: "100px" }}>
            <Row>
              <Col sm={24} lg={14} style={{ backgroundColor: "" }}>
                <ImageCollage images={images} />
              </Col>
              <Col sm={24} lg={10} style={{ backgroundColor: "" }}>
                <Row justify={"center"} align="top" style={{ marginTop: 20 }}>
                  <Col sm={24} md={20}>
                    <Space direction="horizontal">
                      <Title style={{ margin: "0px 10px 0px 0px" }} level={4}>
                        $ {listPrice?.toLocaleString()}
                      </Title>
                      <Text>{bedroomsTotal} Bed</Text>
                      <Text>{bathroomsTotalInteger} Bath</Text>
                      <Text>
                        {livingArea} {livingAreaUnits}
                      </Text>
                    </Space>

                    <Row>
                      <Text style={{ margin: "5px 0px 0px 10px" }} level={4}>
                        {postalCity}, {stateOrProvince},{postalcode}
                      </Text>
                    </Row>
                    <Row>
                      <span
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: `${standardStatus === "Active" ? "green" : "red"
                            }`,
                          margin: "5px",
                        }}
                      ></span>
                      <Text strong>{standardStatus}</Text>
                    </Row>
                    <Row style={{ marginTop: "15px" }}>
                      <Col style={{ lineHeight: "30px" }}>
                        <Row>
                          <Col span={8}>
                            <Text strong>Property Type</Text>
                          </Col>
                          <Col span={16}>{homeTypeData[propertyType]}</Col>
                        </Row>

                        <Row>
                          <Col span={8}>
                            <Text strong>Lot Size</Text>
                          </Col>
                          <Col span={16}>
                            {lotSizeArea} {lotSizeUnits}
                          </Col>
                        </Row>

                        {Object.entries(formattedResults).map(([key, value]) => (
                          <Row key={key}>
                            <Col span={8}>
                              <Text strong>{key}</Text>
                            </Col>
                            <Col span={16}>{value}</Col>
                          </Row>
                        ))}

                        <Row>
                          <Col span={8}>
                            <Text strong>Number of Units</Text>
                          </Col>
                          <Col span={16}>{numberOfUnitsTotal}</Col>
                        </Row>

                        <Row>
                          <Col span={8}>
                            <Text strong>Utilites</Text>
                          </Col>
                          <Col span={16}>Water, Sewer, Garbage, gas</Col>
                        </Row>

                        <Row>
                          <Col span={8}>
                            <Text strong>Lisitng Provider</Text>
                          </Col>
                          <Col span={16}>
                            Tiffany Rider: 503-380-4875, MLS#23640335 Premiere
                            Property Group, LLC
                          </Col>
                        </Row>
                      </Col>
                    </Row>
                  </Col>
                </Row>
                <Button
                  type="primary"
                  style={{ marginLeft: "50px", marginTop: "30px" }}
                  onClick={() => {
                    setTalkToSalesModal(!isTalkToSalesModalOpen);
                    TagManager.dataLayer({
                      dataLayer: {
                        event: "PROPERTIES_SUBMIT_INQUIRY_TO_SALES",
                      },
                    });
                  }}
                >
                  Talk to Sales
                </Button>
              </Col>
            </Row>
            <Row>
              <Col sm={24} lg={14} style={{ minHeight: "300px" }}>
                <Tabs defaultActiveKey="Overview" items={tabs} />
              </Col>
              <Col sm={24} lg={10} style={{ marginTop: "50px" }}>
                <div
                  style={{
                    width: "300px",
                    height: "200px",
                    background: "grey",
                    margin: "auto",
                    textAlign: "center",
                  }}
                >
                  MAP
                </div>
              </Col>
            </Row>
          </Col>
          : dataNotFound()
      )}

      {isUploadPhotosModalOpen && (
        <UploadPhotosModal
          isOpen={isUploadPhotosModalOpen}
          handleModal={setUploadPhotosModal}
        />
      )}
      {propertyDetails && <PropertyCreateModal
        isCreateModalOpen={isCreateModalOpen}
        toggleCreateModal={toggleCreateModal}
        formData={propertyDetails}
        isEdit={true}
      />}
      <Modal open={isTalkToSalesModalOpen} footer={[]} onCancel={() => handleCancel()}>
      <TalkToSalesModal />
      </Modal>
    </>
  );
}

export default PropertyDetails;
