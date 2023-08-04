import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography, Space, Spin, Pagination, notification } from 'antd'
import PropertyCard from './PropertyCard'
import { sampleProperties } from '../helpers/sampleProperties'
import Filter from './Filter'
import { actions } from '../../../contexts/propertyContext/actions'
import { usePropertiesState, usePropertiesDispatch } from '../../../contexts/propertyContext'

function PropertyListings() {
  const [currentPage, setCurrentPage] = useState(1)
  const [limit, setLimit] = useState(12)

  useEffect(() => {
    // TODO: will be used when API is ready
    // actions.fetchProperties(dispatch)
  }, [])

  const dispatch = usePropertiesDispatch()
  const { isPropertiesLoading, message, success } = usePropertiesState();
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

  const handlePageChange = (e) => {
    setCurrentPage(e)
  }

  const applyFilter = (options) => {
    // actions.fetchProperties(dispatch, limit,currentPage,options)
  }

  const clearFilter = () => {
    setCurrentPage(1)
    // actions.fetchProperties(dispatch, limit,1,options)
  }

  return (
    <>
      {contextHolder}
      <Row justify="center">
        <Col span={22}>
          <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }} className='mt-5 justify-between' >
            <Typography.Title level={4} style={{ padding: "0px 16px" }}>
              Recommended Properties
            </Typography.Title>
            <Filter applyFilter={applyFilter} clearFilter={clearFilter} />
          </Row>
          {isPropertiesLoading
            ? <div className="h-96 flex justify-center items-center">
              <Spin spinning={isPropertiesLoading} size="large" />
            </div>
            :
            <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}>
              {sampleProperties &&
                sampleProperties?.map((property, index) => (
                  property?.listPrice && (
                    <Col key={index} style={{ padding: '10px' }}>
                      <Link to={`/properties/${property?.id}`}>
                        <PropertyCard property={property} />
                      </Link>
                    </Col>
                  )
                ))}
            </Row>
          }
          <Pagination style={{ width: '500px', margin: 'auto', marginTop: "200px" }}
            onChange={(e) => { handlePageChange(e) }} showSizeChanger={false}
            current={currentPage}
            defaultCurrent={1} total={500}
          />
        </Col>
      </Row>
    </>
  );
}

export default PropertyListings