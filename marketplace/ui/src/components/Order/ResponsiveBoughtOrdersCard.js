import { Button, Spin, Typography } from 'antd';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import routes from '../../helpers/routes';

export const ResponsiveBoughtOrderCard = ({ data, isLoading }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const statusComponent = (status) => {
    let classes;
    switch (status) {
      case 'Closed':
        classes = 'text-[#119B2D]';
        break;
      case 'Awaiting Fulfillment':
        classes = 'text-[#FF8C00]';
        break;
      case 'Payment Pending':
        classes = 'text-[#FF8C00]';
        break;
      case 'Canceled':
        classes = 'text-[#FF0000]';
        break;
      case 'Awaiting Shipment':
        classes = 'text-[#13188A]';
        break;
      default:
        classes = 'text-[#202020]';
        break;
    }
    return classes;
  };
  return (
    <Spin
      wrapperClassName="orders_responsive_cards"
      spinning={isLoading}
      delay={500}
      size="large"
    >
      {data.length > 0 ? (
        data.map((item, index) => {
          return (
            <div
              key={index}
              className="z-40 border border-[#E9E9E9] w-full rounded-md flex flex-col justify-center items-center gap-3 pb-4"
            >
              <div
                className={`p-2 px-4 w-full flex justify-between bg-[#E9E9E9]`}
              >
                <Typography>Order Number</Typography>
                <Typography
                  onClick={() => {
                    navigate(
                      routes.BoughtOrderDetails.url.replace(':id', item.address)
                    );
                  }}
                  className={`text-[#13188A] font-semibold cursor-pointer`}
                >
                  {'#' + item?.orderNumber?.orderId || 'N/A'}
                </Typography>
              </div>
              <div className={` px-4 w-full flex justify-between`}>
                <Typography>Seller</Typography>
                {/* <Typography className="text-[#202020] font-semibold" onClick={()=>{navigate(`${routes.MarketplaceUserProfile.url.replace(":commonName", item?.sellersCommonName)}`, { state: { from: location.pathname } })}}>{item?.sellersCommonName || 'N/A'}</Typography> */}
                <Typography
                  className="font-semibold text-[#202020] cursor-pointer" // Add cursor-pointer for visual cue
                  style={{
                    textDecoration:
                      item?.sellersCommonName &&
                      item.sellersCommonName !== 'N/A'
                        ? 'underline'
                        : 'none',
                    cursor:
                      item?.sellersCommonName &&
                      item.sellersCommonName !== 'N/A'
                        ? 'pointer'
                        : 'default',
                  }}
                  onClick={(e) => {
                    if (
                      item?.sellersCommonName &&
                      item.sellersCommonName !== 'N/A'
                    ) {
                      e.preventDefault();
                      const userProfileUrl = `/profile/${encodeURIComponent(item.sellersCommonName)}`;
                      const fullUrl = `${window.location.origin}${userProfileUrl}`;

                      if (e.ctrlKey || e.metaKey) {
                        // Open in a new tab if Ctrl/Cmd is pressed
                        window.open(fullUrl, '_blank');
                      } else {
                        // Use navigate for a normal click, without Ctrl/Cmd
                        navigate(
                          routes.MarketplaceUserProfile.url.replace(
                            ':commonName',
                            item?.sellersCommonName
                          ),
                          { state: { from: location.pathname } }
                        );
                      }
                    }
                  }}
                >
                  {item?.sellersCommonName || 'N/A'}
                </Typography>
              </div>
              <div className={` px-4 w-full flex justify-between`}>
                <Typography>Currency</Typography>
                <Typography className={`text-[#202020] font-semibold`}>
                  {item?.currency || 'N/A'}
                </Typography>
              </div>
              <div className={` px-4 w-full flex justify-between`}>
                <Typography>Order Total</Typography>
                <Typography className={`text-[#202020] font-semibold`}>
                  {item?.orderTotal || 'N/A'}
                </Typography>
              </div>
              <div className={` px-4 w-full flex justify-between`}>
                <Typography>Date</Typography>
                <Typography className={`text-[#202020] font-semibold`}>
                  {item?.date || 'N/A'}
                </Typography>
              </div>
              <div className={` px-4 w-full flex justify-between`}>
                <Typography>Status</Typography>
                <Typography
                  className={`font-semibold ${statusComponent(item?.status)}`}
                >
                  {item?.status || 'N/A'}
                </Typography>
              </div>

              <Button
                onClick={() => {
                  navigate(
                    routes.BoughtOrderDetails.url.replace(':id', item.address)
                  );
                }}
                className="w-1/3 mt-1 text-blue border-blue cursor-pointer font-semibold"
                size="middle"
              >
                More
              </Button>
            </div>
          );
        })
      ) : (
        <Typography className="text-center text-lg m-6 font-semibold">
          No data
        </Typography>
      )}
    </Spin>
  );
};
