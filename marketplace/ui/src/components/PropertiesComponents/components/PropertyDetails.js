import React, { useEffect, useState } from 'react'
import { Spin, Typography, Tabs, Col, Row } from "antd";
import ImageCollage from '../../Carousel/ImageCollage';
import OverviewTab from "./ListingTabs/OverviewTab";
import FeaturesTab from "./ListingTabs/FeaturesTab";
import PriceHistoryTab from "./ListingTabs/PriceHistoryTab";
import ReviewTab from "./ListingTabs/ReviewTab";
import ListingContactCard from './ListingTabs/ListingContactCard';
import { useParams } from 'react-router-dom';
import { actions } from '../../../contexts/propertyContext/actions';
import { usePropertiesDispatch, usePropertiesState } from '../../../contexts/propertyContext';
import { sampleProperties } from '../helpers/sampleProperties';

function PropertyDetails() {
  const [propertyDetail, setPropertyDetail] = useState({})
  const dispatch = usePropertiesDispatch()
  const { isPropertyDetailsLoading } = usePropertiesState()
  let { id } = useParams();

  useEffect(() => {
    // actions.fetchPropertyDetails(dispatch, id)
    const propertyData = sampleProperties?.filter((item) => item?.id === id);
    setPropertyDetail(propertyData[0])
  }, [])

  // Dummy data for Collage & Carousel
  const imglist = propertyDetail?.images;


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
      children: <ReviewTab />,
    },
  ];

  return (
    <>
      {isPropertyDetailsLoading
        ? <div className="h-96 flex justify-center items-center">
          <Spin spinning={isPropertyDetailsLoading} size="large" />
        </div>
        : <Col span={16} style={{ margin: 'auto', marginBottom: '100px' }}>
          <ImageCollage images={imglist} />
          <Row justify={"center"} align="top"
            style={{ marginTop: 50 }} >
            <Col
              sm={24} md={12}
            >
              <Row justify={"space-between"} align="top"  >
                <Typography.Title
                  style={{ marginBottom: 0, fontFamily: "Montserrat" }}
                  level={3}
                >
                  Price
                </Typography.Title>
                <Typography.Title
                  style={{ marginTop: 0, marginRight: 10 }}
                  level={4}
                >
                  $ {propertyDetail?.listPrice}
                </Typography.Title>
              </Row>

              <Row>
                <Typography.Title style={{ marginTop: 2 }} level={4}>
                  {propertyDetail?.postalCity}, {propertyDetail?.stateOrProvince}{" "}
                  {propertyDetail?.postalCode}
                </Typography.Title>
              </Row>
              <Row>
                <Typography.Paragraph>
                  <b>
                    8 br | 4 ba |{" "}
                    3706 sqft
                  </b>
                </Typography.Paragraph>
              </Row>

              <Row>
                <Col>
                  <Typography.Paragraph>
                    Est. Fully Occupied Rent:{" "}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    Est. Capitalization Rate:{" "}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    Est. Property Insurance:{" "}
                  </Typography.Paragraph>
                </Col>
                <Col offset={1}>
                  <Typography.Paragraph>
                    <b>
                      $4,800/month
                    </b>
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    <b>
                      N/A
                    </b>
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    <b>
                      N/A
                    </b>
                  </Typography.Paragraph>
                </Col>
              </Row>

              <Row gutter={{ xs: 20, sm: 20, md: 20, lg: 24, xl: 24 }}>
                <Tabs defaultActiveKey="Overview" items={tabs} />
              </Row>
            </Col>

            <Col sm={{ span: 24, offset: 0 }} md={{ span: 10, offset: 2 }}>
              <ListingContactCard />
            </Col>
          </Row>
        </Col>
      }
    </>
  )
}

export default PropertyDetails