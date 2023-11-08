import { Col, Row, Table, Typography } from 'antd';
import React from 'react'
import SavingCard from './SavingCard';
import { ServiceColumn } from './ServiceColumn';
const { Text } = Typography;

const ServiceTabCard = ({ serviceList, savingsList }) => {
  return (
    <Row>
      <Text className="leading-6 text-lg block font-semibold pb-3">
        Services
      </Text>
      <Col span={24}>
        <Table
          className="inventory-table"
          columns={ServiceColumn()}
          dataSource={serviceList}
          pagination={false}
          scroll={{ y: 300 }}
        />
      </Col>
      <Text className="leading-6 text-lg block font-semibold pb-3 mt-4">
        Savings
      </Text>
      <hr style={{ color: "grey" }} />
      <Col span={24} className="max-h-96 overflow-y-auto">
        <Row>
          {savingsList.map(({ serviceName, serviceCost }, index) => {
            return (
              <Col span={8} key={index}>
                <SavingCard serviceName={serviceName} serviceCost={serviceCost} />
              </Col>
            );
          })}
        </Row>
      </Col>
    </Row>
  )
}

export default ServiceTabCard
