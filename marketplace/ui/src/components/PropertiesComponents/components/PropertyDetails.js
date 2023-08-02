import React, { useEffect } from 'react'
import { Spin, Typography, Tabs, Col, Row } from "antd";
import ImageCollage from '../../Carousel/ImageCollage';
import OverviewTab from "./ListingTabs/OverviewTab";
import FeaturesTab from "./ListingTabs/FeaturesTab";
import PriceHistoryTab from "./ListingTabs/PriceHistoryTab";
import ReviewTab from "./ListingTabs/ReviewTab";
import ListingContactCard from './ListingTabs/ListingContactCard';
import { useParams } from 'react-router-dom';
import { actions } from '../../../contexts/propertyContext/actions';
import { usePropertiesDispatch } from '../../../contexts/propertyContext';

function PropertyDetails() {
  const dispatch = usePropertiesDispatch()
  let { id } = useParams();

  useEffect(() => {
    // actions.fetchPropertyDetails(dispatch, id)
  }, [])

  // Dummy data for Collage & Carousel
  const imglist = [
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m1607154818od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m3497275450od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m3180059059od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m1194456964od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m2512788875od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m2935903856od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m210456744od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m1069665804od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m2999610083od-w1024_h768_x2.webp',
    'https://ap.rdcpix.com/48c9911bf74a48c6734b9f3fbdf677abl-m876342709od-w1024_h768_x2.webp'
  ]

  const property = {
    fields: "hello"
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
      <Col span={16} style={{ margin: 'auto', marginBottom: '100px' }}>
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
                $ 3000
              </Typography.Title>
            </Row>

            <Row>
              <Typography.Title style={{ marginTop: 2 }} level={4}>
                Brooklyn, NewYork{" "}
                11203
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
    </>
  )
}

export default PropertyDetails