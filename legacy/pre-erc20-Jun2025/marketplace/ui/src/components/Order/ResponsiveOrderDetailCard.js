import { Typography } from 'antd';
import React from 'react';
import image_placeholder from '../../images/resources/image_placeholder.png';

export const ResponsiveOrderDetailCard = ({ data }) => {
  return (
    <div className="flex flex-col md:hidden shadow-card_shadow p-3 py-4 mt-1 rounded-md">
      {data?.productImage !== image_placeholder && (
        <img
          src={data?.productImage}
          alt=""
          className="w-full h-36 object-contain"
        />
      )}
      <div className="flex justify-between py-2">
        <Typography className="text-[#6A6A6A]">Product Name</Typography>
        <Typography className="font-semibold">{data?.name || 'N/A'}</Typography>
      </div>
      <div className="flex justify-between py-2">
        <Typography className="text-[#6A6A6A]">Quantity</Typography>
        <Typography className="font-semibold">
          {data?.quantity || 'N/A'}
        </Typography>
      </div>
      <div className="flex justify-between py-2">
        <Typography className="text-[#6A6A6A]">{'Unit Price'}</Typography>
        <Typography className="font-semibold text-[#119B2D]">
          {data?.unitPrice || 0}
        </Typography>
      </div>
      <div className="flex justify-between py-2 px-2 my-1 rounded-md bg-[#EEEFFA]">
        <Typography className="font-semibold">{'Amount'}</Typography>
        <Typography className="font-semibold text-[#119B2D]">
          {data?.amount || 0}
        </Typography>
      </div>
    </div>
  );
};
