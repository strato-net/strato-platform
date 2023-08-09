import React from "react";
import { Card, Carousel } from "antd";

function PropertyCard(props) {
  const { property,
    property: {
      images,
      postalCity,
      stateOrProvince,
      postalCode,
      bedroomsTotal,
      bathroomsTotalInteger,
      lotSizeArea,
      listPrice }
  } = props;
  const { Meta } = Card;

  return (
    <Card
      hoverable
      style={{ width: 300, margin: 10 }}
      cover={
        <Carousel>
          {images?.map((img, key) => (
            <div key={key}>
              <img
                style={{ width: "100%", height: 200 }}
                alt={img.url}
                src={img}
              />
            </div>
          ))}
        </Carousel>
      }
    >
      <Meta
        title={`${postalCity}, ${stateOrProvince} ${postalCode}`}
        description={`${bedroomsTotal} br | 
        ${bathroomsTotalInteger} ba | 
        ${lotSizeArea} sqft | 
        $${listPrice?.toLocaleString()}`}
      />
    </Card>
  );
}

export default PropertyCard;
