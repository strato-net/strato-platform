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
        <Carousel arrows>
          {property?.fields?.Photos?.map((img: any, key: any) => (
            <div key={key}>
              <img
                style={{ width: "100%", height: 200 }}
                alt={img.url}
                src={`${img.url}`}
              />
            </div>
          ))}
        </Carousel>
      }
    >
      <Meta
        title={`${property?.PostalCity}, ${property?.StateOrProvince}`}
        description={`${property?.fields?.Beds} br | ${
          property?.fields?.Baths
        } ba | ${
          property?.fields?.SqFt
        } sqft | $${property.ListPrice?.toLocaleString()}`}
      />
    </Card>
  );
}

export default PropertyCard;
