import { ShoppingCartOutlined } from '@ant-design/icons'
import React, { useState } from "react";
import {
    Typography,
    Button,
    notification,
    InputNumber,
    Tooltip
} from "antd";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";
import { setCookie } from "../../helpers/cookie";
import { Images } from '../../images';
import images_placeholder from "../../images/resources/image_placeholder.png"

const NewTrendingCard = ({ topSellingProduct, addItemToCart, parent = "" }) => {
    const [quantity, setQuantity] = useState(1)
    const [api, contextHolder] = notification.useNotification();

    let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();

    const naviroute = routes.MarketplaceProductDetail.url;
    const navigate = useNavigate();

    return (
        <div className={`trending_cards_container_card bg-white p-3 ${parent == 'Marketplace' ? 'min-w-[300px] w-auto' : 'min-w-[230px]'} xs:min-w-[230px] md:min-w-[300px] rounded-md flex flex-col gap-2 md:gap-3 shadow-card_shadow h-max`}>
            {contextHolder}
            <a
                href={`/marketplace${naviroute.replace(":address", topSellingProduct.address)}`}
                onClick={(e) => {
                    // Check if Command (metaKey) or Ctrl (ctrlKey) is pressed
                    if (e.metaKey || e.ctrlKey) {
                        // Let the browser handle it natively to open in a new tab
                    } else {
                        e.preventDefault();
                        navigate(`${naviroute.replace(":address", topSellingProduct.address)}`, { state: { isCalledFromInventory: false } });
                    }
                }}
            >
                <img
                    className='md:h-[200px] md:w-[40vw] h-[150px] w-full object-contain rounded-md cursor-pointer mb-2'
                    src={topSellingProduct.images ? topSellingProduct?.images[0] : images_placeholder}
                    alt={topSellingProduct?.name || "N/A"}
                />
                <div className='flex justify-between items-center'>
                    <Typography
                        className='font-semibold overflow-hidden cursor-pointer w-[180px] md:w-[220px] whitespace-nowrap text-ellipsis'
                    >
                        <Tooltip title={topSellingProduct?.name.length > 20 ? topSellingProduct?.name : null}>
                <span className=" whitespace-nowrap max-w-[160px] inline-block">
                    {topSellingProduct?.name.length > 20 ? `${topSellingProduct?.name.slice(0, 20)}...` : `${topSellingProduct?.name}`}
                </span>
                </Tooltip>
                        {/* {topSellingProduct?.name || "N/A"} */}
                    </Typography>
                    <img className='w-4 h-4' src={Images.Verified} alt='verified' />
                </div>
            </a>
            <Typography className='font-normal text-black'>{'$' + topSellingProduct?.price || "N/A"}</Typography>
            <Typography className={`#989898 opacity-40 max-h-5 overflow-hidden ${parent == 'Marketplace' ? 'hidden md:flex' : ''}`}>{topSellingProduct?.description || "N/A"}</Typography>
            <div className='flex justify-between items-center bg-[#EEEFFA] p-2 rounded-[4px]'>
                <Typography>Quantity:</Typography>
                <div className='flex gap-3 p-1 bg-white'>
                    <Typography className={`px-2 bg-[#EEEFFA] rounded-sm ${quantity === 1 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} onClick={() => {
                        setQuantity(quantity == 1 ? quantity : quantity - 1)
                    }}>
                        -
                    </Typography>
                    <InputNumber 
                        className="w-10" 
                        size="small" 
                        bordered={false} 
                        value={quantity} 
                        max={topSellingProduct.saleQuantity}
                        min={1}
                        onChange={setQuantity}
                        onPressEnter={(e) => {
                            const newValue = parseInt(e.target.value, 10);
                            if (newValue <= topSellingProduct.saleQuantity) {
                                setQuantity(newValue);
                            } else {
                                api.error({
                                    message: "Cannot add more than available quantity",
                                    placement: "bottom",
                                });
                            }
                        }}  
                        controls={false}/>
                    <Typography className={`px-2 bg-[#EEEFFA] rounded-sm ${quantity >= Math.min(topSellingProduct.saleQuantity, topSellingProduct.quantity) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} onClick={() => {
                        if ((quantity + 1 <= topSellingProduct.saleQuantity) && (quantity + 1 <= topSellingProduct.quantity)) {
                            setQuantity(quantity + 1)
                        }
                    }}>
                        +
                    </Typography>
                </div>
            </div>
            <div className='flex gap-4 mt-1'>
                <Button
                    id={`${topSellingProduct.name.replace(/ /g, "_")}-buy-now`}
                    type='primary'
                    className='flex-1 h-9 !bg-[#13188A] !text-white'
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
                            if (addItemToCart(topSellingProduct, quantity)) {
                                navigate("/checkout")
                            }
                        }
                    }}
                >
                    Buy Now
                </Button>
                <Button
                className='h-9 w-9 flex items-center justify-center !bg-[#13188A] '
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
                            addItemToCart(topSellingProduct, quantity);
                        }
                    }}
                    type='primary'
                >
                   
                    <img src={Images.Cart} alt='Cart' width={18} height={18} className='max-w-[18px]'/>
                    
                    {/* <ShoppingCartOutlined style={{ color: '#EEEFFA' , width:'18px' ,  height:'18px' }} /> */}
                </Button>
            </div>
        </div>
    )
}

export default NewTrendingCard