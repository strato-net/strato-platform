import React from 'react'
import { Col, Typography } from 'antd';
import ParagraphEllipsis from '../../Ellipsis/ParagraphEllipsis';
const { Text, Paragraph } = Typography;

const InformationCard = ({ detailTabSchema, additionalInfo }) => {
  return (
    <>
      <Text className="leading-6 text-lg block font-semibold pb-3">
        Information
      </Text>
      <Col
        xl={{ span: 14 }}
        className="border-grey shadow-lg leading-2 w-full rounded-md p-4 "
        style={{ height: "auto", display: "inline-block" }}
      >
        {detailTabSchema.map((item, index) => {
          return (
            <Paragraph key={index}>
              <Text className="font-bold text-grey font-poppin">
                {item.label}
              </Text>
              {item.type === "Text" && <Text strong className="float-right">
                {item.value ?? "--"}
              </Text>}
              {item.type === "Paragraph" && <ParagraphEllipsis description={additionalInfo ?? "--"} />}
            </Paragraph>
          );
        })}
      </Col>
    </>
  )
}

export default InformationCard
