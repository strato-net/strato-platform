import React, { useEffect, useState } from 'react'
import { Spin, Typography, Tabs, Col, Row, notification, Button, Space } from "antd";
import ImageCollage from '../../Carousel/ImageCollage';
import OverviewTab from "./ListingTabs/OverviewTab";
import FeaturesTab from "./ListingTabs/FeaturesTab";
import PriceHistoryTab from "./ListingTabs/PriceHistoryTab";
import ReviewTab from "./ListingTabs/ReviewTab";
import { useParams } from 'react-router-dom';
import { actions } from '../../../contexts/propertyContext/actions';
import { usePropertiesDispatch, usePropertiesState } from '../../../contexts/propertyContext';
import UploadPhotosModal from '../../Product/UploadPhotosModal';
import { appliancesData, coolingData, exteriorFeaturesData, flooringData, heatingData, interiorFeaturesData, parkingFeaturesData } from '../helpers/constants';

function PropertyDetails() {
  const [isUploadPhotosModalOpen, setUploadPhotosModal] = useState(false);
  const dispatch = usePropertiesDispatch()
  const { property, propertyDetails, isPropertyDetailsLoading, message, success } = usePropertiesState()
  let { id } = useParams();

  useEffect(() => {
    actions.fetchPropertyDetails(dispatch, id)
  }, [])
  const { Text, Title } = Typography

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

  const {
    images,
    reviews,
    postalCity,
    postalcode,
    stateOrProvince,
    appliances,
    cooling,
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
    numberOfUnitsTotal
  } = propertyDetails || {};

  let appliance = []
  let coolings = []
  let heating = []
  let flooring = []
  let utilities = []
  let parking = []

  const seperateKeys = () => {
    let featureData = {}

    featureData["applianceArray"] = appliancesData.map(item => item.value)
    featureData["coolingArray"] = coolingData.map(item => item.value)
    featureData["heatingArray"] = heatingData.map(item => item.value)
    featureData["flooringArray"] = flooringData.map(item => item.value)
    featureData["parkingArray"] = parkingFeaturesData.map(item => item.value)
    featureData["interiorArray"] = interiorFeaturesData.map(item => item.value)
    featureData["exteriorArray"] = exteriorFeaturesData.map(item => item.value)

    for (let key in propertyDetails) {
      if (typeof propertyDetails[key] === 'boolean' && propertyDetails[key]) {
        switch (true) {
          case featureData["applianceArray"].includes(key):
            appliance.push(appliancesData[featureData["applianceArray"].indexOf(key)].label);
            break;
          case featureData["coolingArray"].includes(key):
            coolings.push(coolingData[featureData["coolingArray"].indexOf(key)].label);
            break;
          case featureData["heatingArray"].includes(key):
            heating.push(heatingData[featureData["heatingArray"].indexOf(key)].label);
            break;
          case featureData["flooringArray"].includes(key):
            flooring.push(flooringData[featureData["flooringArray"].indexOf(key)].label);
            break;
          case featureData["parkingArray"].includes(key):
            parking.push(parkingFeaturesData[featureData["parkingArray"].indexOf(key)].label);
            break;
          case featureData["interiorArray"].includes(key):
            parking.push(interiorFeaturesData[featureData["interiorArray"].indexOf(key)].label);
            break;
          case featureData["exteriorArray"].includes(key):
            parking.push(exteriorFeaturesData[featureData["exteriorArray"].indexOf(key)].label);
            break;
        }
      }
    }

  }

  const tabs = [
    {
      key: "Overview",
      label: `Overview`,
      children: <OverviewTab property={property?.fields} />,
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
      // children: <ReviewTab reviews={reviews} />,
    },
  ];

  return (
    <>
      {seperateKeys()}
      {contextHolder}
      {message && openToast("bottom")}
      <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }} className='mt-5 justify-between' >
        <Typography.Title level={4} style={{ padding: "0px 16px" }}>
        </Typography.Title>
        <Col style={{ marginRight: "50px" }}>
          <Button type="primary"
            onClick={() => {
              setUploadPhotosModal(true)
            }}
          >Upload Images</Button>
        </Col>
      </Row>
      {isPropertyDetailsLoading
        ? <div className="h-96 flex justify-center items-center">
          <Spin spinning={isPropertyDetailsLoading} size="large" />
        </div>
        : <Col span={22} style={{ margin: 'auto', marginBottom: '100px' }}>
          <Row>
            <Col sm={24} lg={14} style={{ backgroundColor: "" }}>
              <ImageCollage images={images} />
            </Col>
            <Col sm={24} lg={10} style={{ backgroundColor: "" }}>
              <Row justify={"center"} align="top"
                style={{ marginTop: 20 }} >
                <Col
                  sm={24} md={20}
                >

                  <Space direction="horizontal">
                    <Title
                      style={{ margin: "0px 10px 0px 0px" }}
                      level={4}
                    >
                      $ {listPrice}
                    </Title>
                    <Text>{bedroomsTotal} Bed</Text>
                    <Text>{bathroomsTotalInteger} Bath</Text>
                    <Text>{livingArea} {livingAreaUnits}</Text>
                  </Space>

                  <Row>
                    <Text style={{ margin: "5px 0px 0px 10px" }} level={4}>
                      {postalCity}, {stateOrProvince},
                      {postalcode}
                    </Text>
                  </Row>
                  <Row>
                    <span style={{
                      width: '10px', height: "10px", borderRadius: "50%",
                      backgroundColor: `${standardStatus === "Active" ? "green" : "red"}`, margin: '5px'
                    }}>
                    </span>
                    <Text strong>{standardStatus}</Text>
                  </Row>
                  <Row style={{ marginTop: "15px" }} >
                    <Col style={{ lineHeight: "30px" }}>
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
                        <Col span={16}>{lotSizeArea} {lotSizeUnits}</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>appliances</Text>
                        </Col>
                        <Col span={16}>{appliance.join(', ')}</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>Cooling</Text>
                        </Col>
                        <Col span={16}>{coolings.join(', ')}</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>Heating</Text>
                        </Col>
                        <Col span={16}>{heating.join(', ')}</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>Number of Units</Text>
                        </Col>
                        <Col span={16}>
                          {numberOfUnitsTotal}
                        </Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>Utilites</Text>
                        </Col>
                        <Col span={16}>Water, Sewer, Garbage, gas</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>parking</Text>
                        </Col>
                        <Col span={16}>{parking.join(', ')}</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>Lisitng Provider</Text>
                        </Col>
                        <Col span={16}>Tiffany Rider: 503-380-4875, MLS#23640335
                          Premiere Property Group, LLC</Col>
                      </Row>
                    </Col>
                  </Row>
                </Col>
              </Row>
              <Button type='primary' style={{ marginLeft: "50px", marginTop: "30px" }}>Submit  Inquiry</Button>
            </Col>
          </Row>
          <Row >
            <Col sm={24} lg={14} style={{ minHeight: "300px" }}>
              <Tabs defaultActiveKey="Overview" items={tabs} />
            </Col>
            <Col sm={24} lg={10} style={{ marginTop: "50px" }}>
              <div style={{ width: '300px', height: "200px", background: 'grey', margin: 'auto', textAlign: "center" }}>
                MAP
              </div>
            </Col>
          </Row>

        </Col>
      }

      {isUploadPhotosModalOpen && (
        <UploadPhotosModal
          isOpen={isUploadPhotosModalOpen}
          handleModal={setUploadPhotosModal}
        />
      )}
    </>
  )
}

export default PropertyDetails