import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Row, Col, Typography, Spin, Pagination, notification, Button, Tag } from 'antd'
import PropertyCard from './PropertyCard'
import Filter from './Filter'
import { actions } from '../../../contexts/propertyContext/actions'
import { usePropertiesState, usePropertiesDispatch } from '../../../contexts/propertyContext'
import PropertyCreateModal from './PropertyCreateModal'
import { createPropertyFormInitialData, filterlabel, propertyConstants } from '../helpers/constants'
const { LIMIT_PER_PAGE } = propertyConstants;

function PropertyListings() {

  const [filterOption, setFilterOption] = useState({});
  const [appliedFilter, setAppliedFilter] = useState({})
  const [currentPage, setCurrentPage] = useState(1)
  const [limit] = useState(LIMIT_PER_PAGE)
  const [isCreateModalOpen, toggleCreateModal] = useState(false);
  const totalValue = useRef(0);
  const dispatch = usePropertiesDispatch()
  const { properties, isPropertiesLoading, message, success } = usePropertiesState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    document.title = "Welcome to Mercata Properties"
    actions.fetchProperties(dispatch, limit, limit * (currentPage - 1))
  }, [dispatch, currentPage, limit])


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

  const applyFilter = () => {
    setAppliedFilter(filterOption)
    actions.fetchProperties(dispatch, limit, currentPage - 1, filterOption)
  }

  const clearFilter = () => {
    setCurrentPage(1);
    setAppliedFilter({});
    setFilterOption({});
    if (currentPage === 1) {
      actions.fetchProperties(dispatch, limit, currentPage - 1);
    } else {
      setCurrentPage(1);
    }
  }

  const handleTagClose = (name) => {
    let data = { ...appliedFilter };
    delete data[name]
    setFilterOption(data);
    setAppliedFilter(data);
    actions.fetchProperties(dispatch, limit, currentPage - 1, data)
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

  const handleChange = (key, value) => {
    let filter = { ...filterOption };
    filter[key] = value;
    setFilterOption(filter);
  }

  totalValue.current = properties.length === 0
    ? currentPage * LIMIT_PER_PAGE
    : (properties.length === LIMIT_PER_PAGE
      ? (currentPage * LIMIT_PER_PAGE) + 1
      : currentPage * LIMIT_PER_PAGE)
console.log(properties)
  return (
    <>
      {message && openToast("bottom")}
      {contextHolder}
      <Row justify="center">
        <Col span={22}>
          <Row wrap gutter={{ xs: 8, sm: 16, md: 24, lg: 32 }} className='mt-5 justify-between' >
            <Typography.Title level={4} style={{ padding: "0px 16px" }}>
              Recommended Properties
            </Typography.Title>
            <Col style={{ display: "flex", justifyContent: "space-between" }}>
              <Filter applyFilter={applyFilter} clearFilter={clearFilter}
                handleChange={handleChange} filterOption={filterOption} />
              <Button type="primary"
                onClick={() => {
                  toggleCreateModal(true)
                }}
              >List Property</Button>
            </Col>
          </Row>

          {Object.keys(appliedFilter).map((item, index) => {
            if (item === "amenities" && filterOption[item].length === 0) return false;
            return (filterOption[item] && <Tag style={{ margin: "5px" }} key={index}
              closable onClose={() => { handleTagClose(item) }}
            >
              {filterlabel[item]}: {item === "amenities"
                ? filterOption[item].join(", ")
                : (item === "sort_By" ? (filterlabel[filterOption[item]])
                  : filterOption[item])}
            </Tag>)
          })}

          {isPropertiesLoading && loader(isPropertiesLoading)}
          {!isPropertiesLoading && properties.length > 0 && propertyList()}
          {!isPropertiesLoading && !properties.length && dataNotFound()}
          {!isPropertiesLoading &&
            <Row>
              <Col span={10}></Col>
              <Col span={4}>
                <Pagination
                  onChange={(pageNumber) => setCurrentPage(pageNumber)}
                  current={currentPage}
                  defaultCurrent={1}
                  defaultPageSize={LIMIT_PER_PAGE}
                  total={totalValue.current}
                />
              </Col>
              <Col span={10}></Col>
            </Row>}
        </Col>
      </Row>
      <PropertyCreateModal
        isCreateModalOpen={isCreateModalOpen}
        toggleCreateModal={toggleCreateModal}
        formData={createPropertyFormInitialData}
      />
    </>
  );
}

export default PropertyListings