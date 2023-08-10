import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography, Space, Spin, Pagination, notification, Button, Modal } from 'antd'
import PropertyCard from './PropertyCard'
import Filter from './Filter'
import { actions } from '../../../contexts/propertyContext/actions'
import { usePropertiesState, usePropertiesDispatch } from '../../../contexts/propertyContext'
import PropertyCreateModal from './PropertyCreateModal'

function PropertyListings() {
  const [currentPage, setCurrentPage] = useState(0)
  const [limit, setLimit] = useState(12)
  const [isCreateModalOpen, toggleCreateModal] = useState(false);
  const [modalView, setModalView] = useState(true);
  const [isCreateConfirmModalOpen, toggleCreateConfirmModal] = useState(false);

  useEffect(() => {
    actions.fetchProperties(dispatch, limit, currentPage)
  }, [currentPage])

  const dispatch = usePropertiesDispatch()
  const { properties, isPropertiesLoading, isCreatePropertySubmitting, message, success } = usePropertiesState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    if (isCreatePropertySubmitting) {
      toggleCreateModal(false)
      toggleCreateConfirmModal(false)
    }
  }, [isCreatePropertySubmitting])

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

  const propertyList = () => {
    return (
      <>
        <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }}>
          {properties &&
            properties?.map((property, index) => {
              const { listPrice, address } = property
              return listPrice && (
                <Col key={index} style={{ padding: '10px' }}>
                  <Link to={`/properties/${address}`}>
                    <PropertyCard property={property} />
                  </Link>
                </Col>
              )
            })}
        </Row>
        <Pagination style={{ width: '500px', margin: 'auto' }}
          onChange={(e) => { handlePageChange(e) }} showSizeChanger={false}
          current={currentPage}
          defaultCurrent={1} total={500}
        />
      </>
    )
  }

  const loader = (isActive) => {
    return (
      <div className="h-96 flex justify-center items-center">
        <Spin spinning={isActive} size="large" />
      </div>
    )
  }

  const dataNotFound = () => {
    return (
      <div className="h-96 flex justify-center items-center" id="product-list">
        No property available
      </div>
    )
  }

  return (

    <>
      {isCreatePropertySubmitting
        ? loader(isCreatePropertySubmitting)
        : <>
          {contextHolder}
          <Row justify="center">
            <Col span={22}>
              <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }} className='mt-5 justify-between' >
                <Typography.Title level={4} style={{ padding: "0px 16px" }}>
                  Recommended Properties
                </Typography.Title>
                <Col style={{ display: "flex", justifyContent: "space-between" }}>
                  <Filter applyFilter={applyFilter} clearFilter={clearFilter} />
                  <Button type="primary"
                    onClick={() => {
                      toggleCreateModal(true)
                    }}
                  >List Property</Button>
                </Col>
              </Row>
              {isPropertiesLoading && loader(isPropertiesLoading)}
              {!isPropertiesLoading && properties.length > 0 && propertyList()}
              {!isPropertiesLoading && !properties.length && dataNotFound()}

            </Col>
          </Row>
          <PropertyCreateModal
            isCreateModalOpen={isCreateModalOpen}
            toggleCreateModal={toggleCreateModal}
            modalView={modalView}
            setModalView={setModalView}
            isCreateConfirmModalOpen={isCreateConfirmModalOpen}
            toggleCreateConfirmModal={toggleCreateConfirmModal}
          />
        </>
      }
    </>
  );
}

export default PropertyListings