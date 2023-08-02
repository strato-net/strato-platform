import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography, Space } from 'antd'
import PropertyCard from './PropertyCard'
import { sampleProperties } from '../helpers/sampleProperties'
import Filter from './Filter'
import { actions } from '../../../contexts/propertyContext/actions'
import { usePropertiesState, usePropertiesDispatch } from '../../../contexts/propertyContext'

function PropertyListings() {
  const dispatch = usePropertiesDispatch()

  useEffect(() => {
    // TODO: will be used when API is ready
    // actions.fetchProperties(dispatch)
  }, [])

  return (
    <>
    <Row justify="center">
    <Col span={22}>
      <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }} className='mt-5 justify-between' >
        <Typography.Title level={4} style={{ padding: "0px 16px" }}>
          Recommended Properties
        </Typography.Title>
        <Filter />
      </Row>
      <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}>
        {sampleProperties &&
          sampleProperties.map((property, index) => (
            property?.listPrice && (
              <Col key={index} style={{padding:'10px'}}>
                <Link to={`/properties/${property.id}`}>
                  <PropertyCard property={property} />
                </Link>
              </Col>
            )
          ))}
      </Row>
    </Col>
    </Row>
    </>
  );
}

export default PropertyListings