import React from "react";
import { Card, Carousel } from "antd";

const images = [
  "https://images.pexels.com/photos/186077/pexels-photo-186077.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  "https://images.pexels.com/photos/1732414/pexels-photo-1732414.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  "https://images.pexels.com/photos/106399/pexels-photo-106399.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  "https://images.pexels.com/photos/3935328/pexels-photo-3935328.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  "https://images.pexels.com/photos/8894808/pexels-photo-8894808.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  "https://images.pexels.com/photos/13008560/pexels-photo-13008560.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1"
]

function PropertyCard(props) {
  const { property,
    property: {
      // images,
      postalCity,
      stateOrProvince,
      postalcode,
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
        title={`${postalCity}, ${stateOrProvince} ${postalcode}`}
        description={`${bedroomsTotal} br | 
        ${bathroomsTotalInteger} ba | 
        ${lotSizeArea} sqft | 
        $${listPrice?.toLocaleString()}`}
      />
    </Card>
  );
}

export default PropertyCard;
