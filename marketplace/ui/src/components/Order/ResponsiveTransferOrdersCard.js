import { Spin, Typography } from "antd";
import React from "react";

export const ResponsiveTransferOrderCard = ({ data, isLoading}) => {
    
    return (
        <Spin wrapperClassName="orders_responsive_cards" spinning={isLoading} delay={500} size="large">
            { data.length > 0 ? data.map((item,index) => {
                    return (
                <div key={index} className="z-40 border border-[#E9E9E9] w-full rounded-md flex flex-col justify-center items-center gap-3 pb-4">
                        <div className={`p-2 px-4 w-full flex justify-between bg-[#E9E9E9]`}>
                            <Typography>Transfer Number</Typography>
                            <Typography>{item?.transferNumber || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>From</Typography>
                            <Typography>{item?.oldOwnerCommonName || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>To</Typography>
                            <Typography className={`text-[#202020]`}>{item?.newOwnerCommonName || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>Date</Typography>
                            <Typography className={`text-[#202020]`}>{item?.transferDate || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>Asset Name</Typography>
                            <Typography className={`text-[#202020]`}>{item?.assetName || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>Quantity</Typography>
                            <Typography className={`text-[#202020]`}>{item?.quantity || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>Price</Typography>
                            <Typography className={`text-[#202020]`}>{item?.price ? `$ ${item?.price}` : 'N/A'}</Typography>
                        </div>
                </div>
                    )
            }) : <Typography  className="text-center text-lg m-6 font-semibold">No data</Typography> }
        </Spin>
    )
}