import React from "react";
import { Card, Carousel } from "antd";

function PropertyCard(props) {
  const { property } = props;
  const { Meta } = Card;

  return (
    <Card
      hoverable
      style={{ width: 300, margin: 10 }}
      cover={
        <Carousel>
          {property?.images.map((img, key) => (
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
        title={`${property?.postalCity}, ${property?.stateOrProvince} ${property?.postalCode}`}
        description={`${property?.bedroomsTotal} br | 
        ${property?.bathroomsTotalInteger} ba | 
        ${property?.lotSizeArea} sqft | 
        $${property.listPrice?.toLocaleString()}`}
      />
    </Card>
  );
}

export default PropertyCard;
