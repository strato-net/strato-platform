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
import { sampleProperties } from '../helpers/sampleProperties';
import UploadPhotosModal from '../../Product/UploadPhotosModal';

function PropertyDetails() {
  const [propertyDetail, setPropertyDetail] = useState({})
  const [isUploadPhotosModalOpen, setUploadPhotosModal] = useState(false);
  const dispatch = usePropertiesDispatch()
  const { isPropertyDetailsLoading, message, success } = usePropertiesState()
  let { id } = useParams();

  useEffect(() => {
    // actions.fetchPropertyDetails(dispatch, id)
    const propertyData = sampleProperties?.filter((item) => item?.id === id);
    setPropertyDetail(propertyData[0])
  }, [])
  const { Text, Title, Paragraph } = Typography

  const [api, contextHolder] = notification.useNotification();

  const openToast = (placement) => {

    if (success) {
      api.success({
        message: "message-success",
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: "message-failed",
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  // Dummy data for Collage & Carousel
  const { images,
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
    bathroomsTotalInteger
  } = propertyDetail

  const property = {
    fields: "Property detail"
  }

  const tabs = [
    {
      key: "Overview",
      label: `Overview`,
      children: <OverviewTab property={property.fields} />,
    },
    {
      key: "Features",
      label: `Features`,
      children: <FeaturesTab property={property.fields} />,
    },
    {
      key: "Price",
      label: `Price and Tax History`,
      children: <PriceHistoryTab property={property.fields} />,
    },
    {
      key: "Reviews",
      label: `Reviews`,
      children: <ReviewTab reviews={reviews} />,
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
            <Col sm={24} lg={12} style={{ backgroundColor: "" }}>
              <ImageCollage images={images} />
            </Col>
            <Col sm={24} lg={12} style={{ backgroundColor: "" }}>
              <Row justify={"center"} align="top"
                style={{ marginTop: 20 }} >
                <Col
                  sm={24} md={20}
                >
                  <Row justify={"space-between"} align="top"  >
                    <Title
                      style={{ marginTop: 0, marginRight: 10 }}
                      level={4}
                    >
                      $ {listPrice}
                    </Title>
                    <Col span={12} style={{ display: "flex", justifyContent: "space-around" }}>
                      <Text>{bedroomsTotal} Bed</Text>
                      <Text>{bathroomsTotalInteger} Bath</Text>
                      <Text>{livingArea} {livingAreaUnits}</Text>
                    </Col>
                  </Row>
                  <Row>
                    <Text style={{ marginTop: 2 }} level={4}>
                      {postalCity}, {stateOrProvince}{" "}
                      {postalCode}
                    </Text>
                  </Row>
                  <Text strong>Active</Text>
                  <Row>
                    <Col>
                      <Paragraph>
                        <b>
                          Property Type:{" "}
                        </b>
                      </Paragraph>
                      <Paragraph>
                        <b>
                          Lot Size:{" "}
                        </b>
                      </Paragraph>
                      <Paragraph>
                        <b>
                          Appliances:{" "}
                        </b>
                      </Paragraph>
                      <Paragraph>
                        <b>
                          Cooling:{" "}
                        </b>
                      </Paragraph>
                      <Paragraph>
                        <b>
                          Heating:{" "}
                        </b>
                      </Paragraph>
                      <Paragraph>
                        <b>
                          Number of Units:{" "}
                        </b>
                      </Paragraph>
                    </Col>
                    <Col offset={1}>
                      <Paragraph>
                        {propertyType}
                      </Paragraph>
                      <Paragraph>
                        {lotSizeArea} {lotSizeUnits}
                      </Paragraph>
                      <Paragraph>
                        Refrigerator, Stove, Water heater
                      </Paragraph>
                      <Paragraph>
                        Window Unit
                      </Paragraph>
                      <Paragraph>
                        Wall Heaters
                      </Paragraph>
                      <Paragraph>
                        {unitNumber}
                      </Paragraph>
                    </Col>
                  </Row>
                </Col>
              </Row>
              <Button type='primary' style={{ marginLeft: "50px" }}>Submit  Inquiry</Button>
            </Col>
          </Row>
          <Row >
            <Col sm={24} lg={12} style={{ minHeight: "300px" }}>
              <Tabs defaultActiveKey="Overview" items={tabs} />
            </Col>
            <Col sm={24} lg={12} style={{ marginTop: "20px" }}>
              <div style={{ width: '300px', background: 'grey', margin: 'auto' }}>
                <div class="mapouter"><div class="gmap_canvas">
                  <iframe width="100%" height="100%" id="gmap_canvas"
                    src="https://maps.google.com/maps?q=california&t=&z=10&ie=UTF8&iwloc=&output=embed"
                    frameborder="0" scrolling="no" marginheight="0" marginwidth="0">
                  </iframe></div></div>
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