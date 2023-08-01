import React from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography, Space } from 'antd'
import PropertyCard from './PropertyCard'
import { sampleProperties } from '../helpers/sampleProperties'
import Filter from './Filter'

function PropertyListings() {
  return (
    <>
      <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }} className='mt-5'>
        <Typography.Title level={4} style={{ padding: "0px 16px" }}>
          Recommended Properties
        </Typography.Title>
        <Filter />
      </Row>
      <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}>
        {sampleProperties &&
          sampleProperties.map((property, index) => (
            property?.ListPrice && (
              <Col key={index}>
                <Link to={`/properties/${property.id}`}>
                  <PropertyCard property={property} />
                </Link>
              </Col>
            )
          ))}
      </Row>
    </>
  );
}

export default PropertyListings