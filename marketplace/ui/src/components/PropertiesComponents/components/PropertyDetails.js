import React, { useEffect, useState } from 'react'
import { Spin, Typography, Tabs, Col, Row, notification, Button } from "antd";
import ImageCollage from '../../Carousel/ImageCollage';
import OverviewTab from "./ListingTabs/OverviewTab";
import FeaturesTab from "./ListingTabs/FeaturesTab";
import PriceHistoryTab from "./ListingTabs/PriceHistoryTab";
import ReviewTab from "./ListingTabs/ReviewTab";
import { useParams } from 'react-router-dom';
import { actions } from '../../../contexts/propertyContext/actions';
import { usePropertiesDispatch, usePropertiesState } from '../../../contexts/propertyContext';
import UploadPhotosModal from '../../Product/UploadPhotosModal';

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
    postalCode,
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

  // const property = {
  //   fields: "Property detail"
  // }

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
      {contextHolder}
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
                  <Row align="top"  >
                    <Col span={8}>
                      <Title
                        style={{ marginTop: 0, marginRight: 10 }}
                        level={4}
                      >
                        $ {listPrice}
                      </Title>
                    </Col>
                    <Col span={12} style={{ display: "flex", justifyContent: "space-around" }}>
                      <Text>{bedroomsTotal} Bed</Text>
                      <Text>{bathroomsTotalInteger} Bath</Text>
                      <Text>{livingArea} {livingAreaUnits}</Text>
                    </Col>
                    <Col span={4}></Col>
                  </Row>
                  <Row>
                    <Text style={{ marginTop: 2 }} level={4}>
                      {postalCity}, {stateOrProvince}{" "}
                      {postalCode}
                    </Text>
                  </Row>
                  <Row>
                    {standardStatus === "Active" ? <span style={{ width: '10px', height: "10px", borderRadius: "50%", backgroundColor: "green", margin: '5px' }}></span> : ""}
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
                        <Col span={16}>Refrigerator, Stove, Water heater</Col>
                      </Row>


                      <Row>
                        <Col span={8}>
                          <Text strong>Cooling</Text>
                        </Col>
                        <Col span={16}>Window Unit</Col>
                      </Row>

                      <Row>
                        <Col span={8}>
                          <Text strong>Heating</Text>
                        </Col>
                        <Col span={16}>Wall heaters</Col>
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
                        <Col span={16}>On-street</Col>
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