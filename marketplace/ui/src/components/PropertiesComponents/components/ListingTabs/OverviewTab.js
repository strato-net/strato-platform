import React from 'react'
import { Col, Typography } from 'antd';

function OverviewTab({description}) {
  return (
    <Col>
      <Typography.Paragraph className='text-justify'>
        {description}
      </Typography.Paragraph>
    </Col>
  )
}

export default OverviewTab