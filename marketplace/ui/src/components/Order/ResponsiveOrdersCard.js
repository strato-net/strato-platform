import { Button, Spin, Typography } from "antd";
import React from "react";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";

export const ResponsiveOrderCard = ({ data, isLoading, category}) => {
    const navigate = useNavigate();
    console.log(data, "data")
    return (
        <Spin wrapperClassName="orders_responsive_cards" spinning={isLoading} delay={500} size="large">
            { data.length > 0 ? data.map((item) => {
                    return (
                <div className="z-40 border border-[#E9E9E9] w-full rounded-md flex flex-col justify-center items-center gap-3 pb-4">
                        <div className={`p-2 px-4 w-full flex justify-between bg-[#E9E9E9]`}>
                            <Typography>{category == 'Transfer' ? 'Transfer Number' : 'Order Number'}</Typography>
                                <Typography
                                    onClick={() => {
                                        navigate(
                                            `${category == 'Sold' ? routes.SoldOrderDetails.url.replace(":id", item.address) : routes.BoughtOrderDetails.url.replace(":id", item.address)}`
                                        );
                                    }}
                                    className={`text-[#13188A] cursor-pointer`}
                                >
                                    {category == 'Transfer' ? item?.transferNumber : '#' + item?.orderNumber?.orderId || 'N/A'}
                                </Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>{category == 'Transfer' ? 'From' : 'Buyer'}</Typography>
                            <Typography>{category == 'Sold' ? item?.buyersCommonName : category == 'Transfer' ? item?.oldOwnerOrganization : item?.sellersCommonName || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>{category == 'Transfer' ? 'To' : 'Order Total($)'}</Typography>
                            <Typography className={`text-[#202020]`}>{category == 'Transfer' ? item?.newOwnerOrganization : '$' + item?.orderTotal || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>Date</Typography>
                            <Typography className={`text-[#202020]`}>{item?.date || 'N/A'}</Typography>
                        </div>
                        <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>{category == 'Transfer' ? 'Product Name' : 'Status'}</Typography>
                            <Typography
                                className={`${item.status == 'Closed' ? 'text-[#119B2D]' : item.status == 'Awaiting Fulfillment' ? 'text-[#FF8C00]' : item.status == 'Cancelled' ? 'text-[#FF0000]' : item.status == 'Awaiting Shipment' ? 'text-[#13188A]' : 'text-[#202020]'}`}
                            >{category == 'Transfer' ? item?.productName : item?.status || 'N/A'}</Typography>
                        </div>
                        {category == 'Transfer' && <div className={`p-2 px-4 w-full flex justify-between`}>
                            <Typography>Quantity</Typography>
                            <Typography className={`text-[#202020]`}>{item?.quantity || 'N/A'}</Typography>
                        </div>}
                    {category !== 'Transfer' && <Button 
                        onClick={() => {
                            navigate(
                              `${category == 'Sold' ? routes.SoldOrderDetails.url.replace(":id", item.address) : routes.BoughtOrderDetails.url.replace(":id", item.address)}`
                            );
                          }}
                        className="w-1/3 text-blue border-blue cursor-pointer" 
                        size="middle"
                    >
                        More
                    </Button>}
                </div>
                    )
            }) : <Typography  className="text-center text-lg m-6 font-semibold">No data</Typography> }
        </Spin>
    )
}