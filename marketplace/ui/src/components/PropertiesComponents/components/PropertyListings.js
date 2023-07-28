import React from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography } from 'antd'
import PropertyCard from './PropertyCard'
import { sampleProperties } from '../helpers/sampleProperties'

function PropertyListings() {
  return (
    <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}>
      <Col span={24}>
        <Typography.Title
          level={4}
          ellipsis={{ tooltip: true }}
          style={{ padding: "16px 16px" }}
        >Recommended properties for you
        </Typography.Title>
      </Col>
      {sampleProperties && (
        <Col span={22}>
          <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}>
            {sampleProperties &&
              sampleProperties.map(
                (property, key) =>
                  property?.ListPrice && (
                    <Col key={key}>
                      <Link to={`/${property.id}`}>
                        <PropertyCard property={property} />
                      </Link>
                    </Col>
                  )
              )}
          </Row>
        </Col>
      )}
      <Col span={1}></Col>
    </Row>
  )
}

export default PropertyListings