import React, { useEffect, useState } from "react";
import GoogleMapReact from 'google-map-react';
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
import "../helpers/property.css"
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
import TalkToSalesModal from "./TalkToSalesModal";
import TagManager from "react-gtm-module";
import UploadPhotosModal from "../../Product/UploadPhotosModal";
import { categoriesObj } from "../helpers/constants";
import PropertyCreateModal from "./PropertyCreateModal";
import { useAuthenticateState } from "../../../contexts/authentication";
const AnyReactComponent = ({ text }) => <Col>{text}</Col>;

function PropertyDetails() {
  const [activeTab, setActiveTab] = useState("Overview");
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
  const defaultProps = {
    center: {
      lat: 10.99835602,
      lng: 77.01502627
    },
    zoom: 11
  };

  const images = [
    "https://images.pexels.com/photos/186077/pexels-photo-186077.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
    "https://images.pexels.com/photos/1732414/pexels-photo-1732414.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
    "https://images.pexels.com/photos/106399/pexels-photo-106399.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
    "https://images.pexels.com/photos/3935328/pexels-photo-3935328.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
    "https://images.pexels.com/photos/8894808/pexels-photo-8894808.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
    "https://images.pexels.com/photos/13008560/pexels-photo-13008560.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1"
  ]

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
    // images
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
      key: "overview",
      label: `Overview`,
      children: <OverviewTab id="overview" description={description} />,
    },
    {
      key: "features",
      label: `Features`,
      children: <FeaturesTab id="features" property={property?.fields} />,
    },
    {
      key: "price",
      label: `History`,
      children: <PriceHistoryTab id="price" property={property?.fields} />,
    },
    {
      key: "reviews",
      label: `Reviews`,
      children: <ReviewTab id="reviews" reviews={propertyDetails?.reviews} propertyId={propertyDetails?.address} productId={propertyDetails?.productId} />,
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
      <Col className="h-96 flex justify-center items-center" id="product-list">
        No property detail available
      </Col>
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
            className="px-0 py-4"
          ></Typography.Title>
          <Col className="mr-12">
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
              className="ml-1"
            >
              <EditOutlined />
              Edit
            </Button>
          </Col>
        </>
      </Row>
    )
  }

  return (
    <>
      {contextHolder}
      {message && openToast("bottom")}
      {!isPropertyDetailsLoading
        && propertyDetails?.organization == organization
        && editBox()
      }
      {isPropertyDetailsLoading ? (
        <Col className="h-96 flex justify-center items-center">
          <Spin spinning={isPropertyDetailsLoading} size="large" />
        </Col>
      ) : (
        propertyDetails
          ? <Col span={22} className="m-auto mb-24" >
            <Row>
              <Col sm={24} lg={14} >
                <ImageCollage images={images} />
              </Col>
              <Col sm={24} lg={10} >
                <Row justify={"center"} align="top" className="mt-5">
                  <Col sm={24} md={20}>
                    <Space direction="horizontal">
                      <Title className="m-0 mt-2" level={4}>
                        $ {listPrice?.toLocaleString()}
                      </Title>
                      <Text>{bedroomsTotal} Bed</Text>
                      <Text>{bathroomsTotalInteger} Bath</Text>
                      <Text>
                        {livingArea} {livingAreaUnits}
                      </Text>
                    </Space>

                    <Row>
                      <Text className="m-0 mt-1 mb-2" level={4}>
                        {postalCity}, {stateOrProvince},{postalcode}
                      </Text>
                    </Row>
                    <Row>
                      <span
                        className="w-3 h-3 m-1"
                        style={{
                          borderRadius: "50%",
                          backgroundColor: `${standardStatus === "Active" ? "green" : "red"
                            }`,
                        }}
                      ></span>
                      <Text strong>{standardStatus}</Text>
                    </Row>
                    <Row className="mt-4" >
                      <Col span={24} className="leading-7" >
                        <Row>
                          <Col span={8}>
                            <Text strong>Property Type</Text>
                          </Col>
                          <Col span={16}>{propertyType}</Col>
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
                  className="ml-12 mt-7"
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
              <Col sm={24} lg={14} className="mt-12" >
                <Col className="w-full m-auto text-center h-80" >
                  <GoogleMapReact
                    bootstrapURLKeys={{ key: "" }}
                    defaultCenter={defaultProps.center}
                    defaultZoom={defaultProps.zoom}
                  >
                    <AnyReactComponent
                      lat={59.955413}
                      lng={30.337844}
                      text="My Marker"
                    />
                  </GoogleMapReact>
                </Col>
              </Col>
            </Row>
            <Row>
              <Col sm={24} lg={14} style={{ minHeight: "300px" }}>
                <Col className="tab-card">
                  {tabs.map((tab) => {
                    const { key, label } = tab;
                    return <Col
                      sm={6}
                      key={key}
                      id={key}
                      className="m-auto p-3"
                    >
                      <Col
                        className="p-1 text-center text-base"
                        style={{
                          backgroundColor: activeTab === key && "#EDEDED",
                        }}
                      >
                        <a
                          href={`#${key}`}
                          onClick={() => setActiveTab(key)}
                        >
                          {label}
                        </a>
                      </Col>
                    </Col>
                  })}
                </Col>

                {tabs.map((tab, index) => {
                  const { key, label, children } = tab;
                  return <>
                    <Col id={key}>
                      <Col className="pt-5" >
                        <Typography.Title level={5} className="p-3 rounded-md inline-block" style={{
                          backgroundColor: activeTab === key && "#EDEDED",
                        }}>
                          <a style={{ color: "black" }} href={`#${key}`}>{label}</a>
                        </Typography.Title>
                      </Col>
                      {children}
                    </Col>
                    <Col className="m-13 mx-auto w-full" ></Col>
                  </>
                })}
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
