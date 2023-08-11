import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography, Spin, Pagination, notification, Button } from 'antd'
import PropertyCard from './PropertyCard'
import Filter from './Filter'
import { actions } from '../../../contexts/propertyContext/actions'
import { usePropertiesState, usePropertiesDispatch } from '../../../contexts/propertyContext'
import PropertyCreateModal from './PropertyCreateModal'

const LIMIT_PER_PAGE = 5;

function PropertyListings() {
  const [currentPage, setCurrentPage] = useState(1)
  const [limit] = useState(LIMIT_PER_PAGE)
  const [isCreateModalOpen, toggleCreateModal] = useState(false);
  const [modalView, setModalView] = useState(true);
  const [isCreateConfirmModalOpen, toggleCreateConfirmModal] = useState(false);
  const totalValue = useRef(0);

  const dispatch = usePropertiesDispatch()
  const { properties, isPropertiesLoading, isCreatePropertySubmitting, message, success } = usePropertiesState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    actions.fetchProperties(dispatch, limit, limit * (currentPage - 1))
  }, [dispatch, currentPage, limit])

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

  const applyFilter = (options) => {
    // actions.fetchProperties(dispatch, limit,currentPage,options)
  }

  const clearFilter = () => {
    setCurrentPage(1)
    // actions.fetchProperties(dispatch, limit,1,options)
  }

  const propertyList = () => {
    totalValue.current = properties.length === 5 ? (currentPage * 5) + 1 : currentPage * 5
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
        <Row>
          <Col span={10}></Col>
          <Col span={4}>
            <Pagination
              // style={{ width: '500px', margin: 'auto' }}
              onChange={(pageNumber) => setCurrentPage(pageNumber)}
              current={currentPage}
              defaultCurrent={1}
              defaultPageSize={LIMIT_PER_PAGE}
              total={totalValue.current}
            />
          </Col>
          <Col span={10}></Col>
        </Row>
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