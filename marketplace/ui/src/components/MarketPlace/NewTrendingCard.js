import { ShoppingCartOutlined } from '@ant-design/icons'
import React, { useState } from "react";
import {
  Typography,
  Button,
} from "antd";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";
import { setCookie } from "../../helpers/cookie";
import { Images } from '../../images';

const NewTrendingCard = ({topSellingProduct, addItemToCart, parent = ""}) => {
    const [quantity, setQuantity] = useState(0)

    let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();

    const naviroute = routes.MarketplaceProductDetail.url;  
    const navigate = useNavigate();

    return(
        <div className={`trending_cards_container_card bg-white p-3 px-4 ${parent == 'Marketplace' ? 'min-w-[300px]' : 'min-w-[230px]'} md:min-w-[300px] rounded-md flex flex-col gap-2 md:gap-3 shadow-card_shadow h-max`}>
            <img 
              onClick={() =>
                navigate(`${naviroute.replace(":address", topSellingProduct.address)}`, { state: { isCalledFromInventory: false } })
              }
              className='md:h-[200px] md:w-[40vw] h-[110px] object-cover' 
              src={topSellingProduct.images ? topSellingProduct?.images[0] : ""} 
            />
            <div className='flex justify-between'>
                <Typography 
                  onClick={() =>
                    navigate(`${naviroute.replace(":address", topSellingProduct.address)}`, { state: { isCalledFromInventory: false } })
                  } 
                  className='font-semibold max-h-4 overflow-hidden cursor-pointer'
                >
                  {topSellingProduct?.name || "N/A"}
                </Typography>
                <img src={Images.Verified} alt='' />
            </div>
            <Typography className='font-semibold'>{'$'+topSellingProduct?.price || "N/A"}</Typography>
            <Typography className='#989898 opacity-40 max-h-4 overflow-hidden'>{topSellingProduct?.description || "N/A"}</Typography>
            <div className='flex justify-between items-center bg-[#EEEFFA] p-2'>
                <Typography>Quantity</Typography>
                <div className='flex gap-3 p-1 bg-white'>
                    <Typography className='px-2 bg-[#EEEFFA] cursor-pointer' onClick={()=>setQuantity(quantity == 0 ? quantity : quantity - 1)}>-</Typography>
                    <Typography>{quantity}</Typography>
                    <Typography className='px-2 bg-[#EEEFFA] cursor-pointer' onClick={()=>setQuantity(quantity + 1)}>+</Typography>
                </div>
            </div>
            <div className='flex gap-4'>
                <Button
                    id={`${topSellingProduct.name.replace(/ /g, "_")}-buy-now`}
                    type='primary'
                    className='flex-1'
                    onClick={() => {
                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                            setCookie("returnUrl", `/marketplace/productList/${topSellingProduct.address}`, 10);
                            window.location.href = loginUrl;
                        } else {
                            window.LOQ.push(['ready', async LO => {
                                await LO.$internal.ready('events')
                                LO.events.track('Buy Now (from Top Selling Product)', {
                                    product: topSellingProduct.name,
                                    category: topSellingProduct.category,
                                    productId: topSellingProduct.productId
                                })
                            }])
                            TagManager.dataLayer({
                                dataLayer: {
                                    event: 'buy_now_from_top_selling_product',
                                    product_name: topSellingProduct.name,
                                    category: topSellingProduct.category,
                                    productId: topSellingProduct.productId
                                },
                            });
                            if (addItemToCart(topSellingProduct)) {
                                navigate("/checkout")
                            }
                        }
                    }}
                >Buy Now</Button>
                <Button
                    onClick={() => {
                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                            setCookie("returnUrl", `/marketplace/productList/${topSellingProduct.address}`, 10);
                            window.location.href = loginUrl;
                        } else {
                            window.LOQ.push(['ready', async LO => {
                                await LO.$internal.ready('events')
                                LO.events.track('Add To Cart (from Top Selling Product)', {
                                    product: topSellingProduct.name,
                                    category: topSellingProduct.category,
                                    productId: topSellingProduct.productId
                                })
                            }])
                            TagManager.dataLayer({
                                dataLayer: {
                                    event: 'add_to_cart_from_top_selling_product',
                                    product_name: topSellingProduct.name,
                                    category: topSellingProduct.category,
                                    productId: topSellingProduct.productId
                                },
                            });
                            addItemToCart(topSellingProduct);
                        }
                    }}
                    type='primary'
                >
                    <ShoppingCartOutlined style={{ color: 'white' }} />
                </Button>
            </div>
        </div>
    )
}

export default NewTrendingCard