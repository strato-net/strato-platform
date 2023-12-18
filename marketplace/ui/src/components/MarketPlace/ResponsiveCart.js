import { Button, Row,   Col,  Typography,Divider, InputNumber } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { actions } from "../../contexts/marketplace/actions";
import { Images } from "../../images";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";

const ResponsiveCart = ({ data , confirm ,  AddQty ,  MinusQty ,  ValueQty ,  removeCartList}) => {

  const navigate = useNavigate();
  const [tax, setTax] = useState(0);
  const [shipping, setShipping] = useState(0);
  const { cartList } = useMarketplaceState();
  const [total, setTotal] = useState(0);
  const marketplaceDispatch = useMarketplaceDispatch();
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const [faqOpenState, setFaqOpenState] = useState(Array(data.length).fill(false));
  const toggleFaq = (index) => {
    setFaqOpenState((prev) => {
      const newState = [...prev];
      newState[index] = !newState[index];
      return newState;
    });
  };

  useEffect(() => {
    let t = 0;
    let s = 0;
    let tot = 0;
    data.forEach((element) => {
      t += element.tax;
      s += element.shippingCharges;
      tot += element.amount;
    });
    setTax(t);
    setShipping(s);
    setTotal(tot);
  }, [data]);

  let qty = 1;
  let product;
  cartList.forEach((element) => {
    if (element.product.address === data) {
      qty = element.qty;
      product = element.product;
    }
  });
  
 

  return (
    <div className="h-max border border-[#E9E9E9]  rounded-md mt-3 flex flex-col gap-[18px] p-3  items-center   ">
      {data.map((element,index) => {
           let qty = element.qty;
           let product  =  element
        return (
          <div
            className="p-3 border border-[#E9E9E9] rounded-md w-full sm:w-[95%] md:w-[90%]"
            key={index}
          >
            <div className="flex justify-between ">
              <div className="flex gap-x-3 items-center">
                <img
                  src={element?.item?.image}
                  alt={element?.item?.name}
                  className="w-12 h-12 rounded-[4px] object-contain "
                />
                <Typography className="text-[#13188A] text-base font-medium ">
                  {element?.item?.name}
                </Typography>
              </div>
              <Button
            type="link"
            icon={<img src={Images.CancelIcon} alt="remove"   className="w-[18px] h-[18px] " />}
              onClick={() => {
                removeCartList(element.action);
              }}
              className="hover:text-error cursor-pointer text-xl"
            />
            </div>

              <div className="flex justify-around  items-center">
              <Typography >{`$${element?.unitPrice}`}</Typography>
              <div>
              <div className="flex items-center justify-center mt-2">
              <div
               onClick={() => {
               MinusQty(qty ,  product);
              }}
                className="  w-6 h-6   mr-1 bg-[#E9E9E9] flex justify-center items-center cursor-pointer rounded-full">
                <MinusOutlined className="text-[17px] text-[#202020] font-medium " />
              </div>
              <InputNumber  className=" w-[43px] border-none text-[#202020]  bg-[transparent]  rounded-none outline-none font-medium text-sm text-center flex flex-col justify-center"
                  min={1} value={qty} defaultValue={qty} controls={false}
                  onChange={e => {
                    ValueQty(product , e);
                  }} />
              <div
               onClick={() => {
                AddQty(product);
              }}
                className="  w-6 h-6   ml-1 bg-[#E9E9E9] flex justify-center items-center cursor-pointer rounded-full">
                <PlusOutlined className="text-[17px] text-[#202020] font-medium" />
              </div>
            </div>

              </div>

                 </div>

                 <div className="px-3 py-[10px] flex justify-between items-center rounded-[4px] mt-[18px] bg-[#E9E9E9]">
                     <Typography className="text-[#202020] text-sm font-medium ">Details</Typography>
                     <Button type="link" icon={<img src={Images.Dropdown}  alt="" className={`w-5 h-5 transition-transform transform ${faqOpenState[index] ? 'rotate-180' : 'rotate-0'} `}  onClick={()=>{toggleFaq(index)}}/>} ></Button>
                 </div>
                 
               { faqOpenState[index] && 
               <div className={`overflow-hidden transition-max-height ease-in-out duration-500 ${faqOpenState[index] ? 'max-h-[120px]' : 'max-h-0'}`}>

               <div className={` border-t bg-[#E9E9E9] flex flex-col gap-2 p-2 `}>
                    <div className="flex justify-between">
                         <Typography>Unit price($):</Typography>
                         <Typography>{element?.unitPrice}</Typography>
                     </div><div className="flex justify-between">
                         <Typography>shipping Charges:</Typography>
                         <Typography>{element?.shippingCharges}</Typography>
                     </div><div className="flex justify-between">
                         <Typography>Tax($):</Typography>
                         <Typography>{element?.tax}</Typography>
                     </div>
                 </div> 
                 </div>}


                 <div className="pt-[18px] flex justify-between">
                     <Typography className="text-sm  font-medium text-[#202020]">Amount($):</Typography>
                     <Typography className="text-sm  font-semibold text-[#202020]">{element?.amount}</Typography>
                 
</div>
          </div>
        );
      })}

       <div className=" flex flex-col w-full sm:w-[95%] md:w-[90%]">
      <Row className="   mt-2  bg-[#F6F6F6]">
                        <Col className="w-full  bg-[#F6F6F6]">
                            <Row className="justify-between ">
                                <p className="text-sm w-36 mr-2">Item Total</p>
                           
                                <p className="text-sm ml-2 w-20 text-right">${total}</p>
                            </Row>
                            <Row className="justify-between mt-0.5">
                                <p className="text-sm w-36 mr-2">Tax</p>
                               
                                <p className="text-sm ml-2 w-20 text-right">${tax}</p>
                            </Row>
                            <Row className="justify-between mt-0.5">
                                <p className="text-sm w-36 mr-2">Shipping Charges</p>
                          
                                <p className="text-sm ml-2 w-20 text-right">${shipping}</p>
                            </Row>
                            <Divider />
                            <Row className="justify-between">
                                <p className="text-sm font-semibold w-36 mr-2">Total</p>
                               
                                <p className="text-sm font-semibold ml-2 w-20 text-right">
                                    ${total + tax + shipping}
                                </p>
                            </Row>
                        </Col>
                    </Row>
                { !confirm &&   <Row className="justify-center lg:mt-12 mt-2 ">
                        <Button
                            type="primary"
                            id="submit-order-button"
                            className=" w-full sm:w-44 h-9 bg-primary !hover:bg-primaryHover"
                            onClick={() => {
                                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                    window.location.href = loginUrl;
                                } else {
                                actions.addItemToConfirmOrder(marketplaceDispatch, data);
                                window.LOQ.push(['ready', async LO => {
                                    // Track an event
                                    await LO.$internal.ready('events')
                                    LO.events.track('Submit Order (from cart)')
                                }])
                                TagManager.dataLayer({
                                    dataLayer: {
                                      event: 'submit_order_from_cart',
                                    },
                                  });
                                navigate("/confirmOrder");
                            }}}
                            disabled={data.length === 0}
                        >
                            Submit Order
                        </Button>
                    </Row> }
      </div> 
    </div>
  );
};

export default ResponsiveCart;

