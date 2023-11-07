import React, { useState } from 'react'
import { Typography } from 'antd';
const { Paragraph } = Typography;

const ParagraphEllipsis = ({ description }) => {
  const [isTruncated, setIsTruncated] = useState(true);
  const truncatedContent = description.slice(0, 300);

  const toggleContent = () => {
    setIsTruncated(!isTruncated);
  };

  return (
    <Paragraph
      className="text-primaryC text-[13px] mt-2"
      id="prod-desc"
    >
      {/* {decodeURIComponent(inventoryDetails?.description).replace(/%0A/g, "\n").split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line ?? "--"}
                    <br />
                  </React.Fragment>
                ))} */}
      {isTruncated ? truncatedContent : description}
      {description.length > 299 && <button onClick={toggleContent} className='font-bold'>
        {isTruncated ? '  ...Read more' : ' Read less'}
      </button>}
    </Paragraph>
  )
}

export default ParagraphEllipsis