import { Button, Row,  Typography, InputNumber } from "antd";
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
import { actions as orderActions } from "../../contexts/order/actions"
import { useOrderDispatch } from "../../contexts/order";


const ResponsiveCart = ({
  data,
  confirm,
  AddQty,
  MinusQty,
  ValueQty,
  removeCartList,
  openToastOrder
}) => {
  const navigate = useNavigate();
  const [tax, setTax] = useState(0);
  const [shipping, setShipping] = useState(0);
  const { cartList } = useMarketplaceState();
  const [total, setTotal] = useState(0);
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const [faqOpenState, setFaqOpenState] = useState(
    Array(data.length).fill(false)
  );
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
    <div className=" border border-[#E9E9E9]  rounded-md mt-3 flex flex-col gap-[18px]   sm:w-[400px] md:w-[450px]  items-center    ">
      {data.map((element, index) => {
        let qty = element.qty;
        let product = element;
        return (
          <div className="p-3 w-full">
            <div
              className="p-3  border border-[#E9E9E9]  rounded-md w-full "
              key={index}
            >
              <div className="flex justify-between ">
                <div className="flex gap-x-3 ">
                  <img
                    src={element?.item?.image}
                    className="w-12 h-12 rounded-[4px]  "
                  />
                  <Typography className="text-[#13188A] text-base mt-[-4px] font-semibold ">
                    {element?.item?.name}
                  </Typography>
                </div>
                <div className="mt-[-9px]">
                  <Button
                    type="link"
                    icon={
                      <img
                        src={Images.CancelIcon}
                        alt="remove"
                        className="w-[18px] h-[18px] "
                      />
                    }
                    onClick={() => {
                      removeCartList(element.action);
                    }}
                    className="hover:text-error cursor-pointer text-xl"
                  />
                </div>
              </div>

              <div className="flex justify-between ml-[20%]  items-baseline">
                <Typography className="font-semibold text-[#202020] text-sm">{`$${element?.unitPrice}`}</Typography>
                <div>
                  <div className="flex items-center justify-center mt-2">
                    <div
                      onClick={() => {
                        MinusQty(qty, product);
                      }}
                      className={`w-6 h-6 bg-[#E9E9E9] flex justify-center items-center rounded-full ${qty === 1 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    >
                      <p className="text-lg text-[#202020] font-medium">-</p>
                    </div>
                    <InputNumber
                      className=" w-[3rem] border-none text-[#202020] font-medium bg-[transparent]  rounded-none outline-none  text-sm text-center flex flex-col justify-center"
                      min={1}
                      value={qty}
                      defaultValue={qty}
                      controls={false}
                      onChange={(e) => {
                        ValueQty(product, e);
                      }}
                    />
                    <div
                      onClick={() => { 
                        AddQty(product);
                      }}
                      className={`w-6 h-6 bg-[#E9E9E9] flex justify-center items-center rounded-full ${qty >= product.quantity ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    >
                     <p className="text-lg text-[#202020] font-medium">+</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-3 h-10 flex justify-between items-center rounded-md mt-[14px] bg-[#F6F6F6]">
                <Typography className="text-[#202020] text-sm font-semibold ">
                  Details
                </Typography>
                <Button
                  type="link"
                  icon={
                    <img
                      src={Images.Dropdown}
                      alt=""
                      className={`w-5 h-5 transition-transform transform ${
                        faqOpenState[index] ? "rotate-180" : "rotate-0"
                      } `}
                      onClick={() => {
                        toggleFaq(index);
                      }}
                    />
                  }
                ></Button>
              </div>

              {faqOpenState[index] && (
                <div
                  className={`overflow-hidden   ${
                    faqOpenState[index] ? "max-h-[145px] open" : "max-h-0 faq-container"
                  }`}
                >
                  <div
                    className={`  bg-[#F6F6F6] rounded-b-md flex flex-col gap-3 px-3 py-2 `}
                  >
                    <div className="w-full bg-[#BABABA] h-[1px]"></div>
                    <div className="flex justify-between">
                      <Typography className="text-sm text-[#202020] font-medium">Seller:</Typography>
                      <Typography className="text-sm text-[#202020] font-semibold w-[130px] sm:w-[200px] text-right overflow-hidden whitespace-nowrap text-ellipsis">{element?.sellersCommonName}</Typography>
                    </div><div className="flex justify-between">
                      <Typography className="text-sm text-[#202020] font-medium">Unit Price($):</Typography>
                      <Typography className="text-sm text-[#202020] font-semibold">{`$${element?.unitPrice}`}</Typography>
                    </div>
                    <div className="flex justify-between">
                      <Typography className="text-sm text-[#202020] font-medium">Shipping Charges:</Typography>
                      <Typography className="text-sm text-[#202020] font-semibold">{ '$'+ element?.shippingCharges} </Typography>
                    </div>
                    <div className="flex justify-between">
                      <Typography  className="text-sm text-[#202020] font-medium">Tax($):</Typography>
                      <Typography className="text-sm text-[#202020] font-semibold">{'$'+element?.tax}</Typography>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-[18px] flex justify-between ">
                <Typography className="text-sm  font-semibold text-[#202020]">
                  Amount($):
                </Typography>
                <Typography className="text-sm  font-semibold text-[#202020]">
                  {'$'+ element?.amount}
                </Typography>
              </div>
            </div>
          </div>
        );
      })}

      <div className=" flex flex-col w-full  bg-[#F6F6F6] px-[10px] py-3">
        <div className=" flex flex-col gap-3">
          <div className="flex justify-between">
            <p className="text-sm  font-medium ">Sub Total:</p>
            <p className="text-sm  text-right font-semibold">${total}</p>
          </div>
          <div className="flex justify-between">
            <p className="text-sm font-medium  ">Tax:</p>

            <p className="text-sm  font-semibold  text-right">${tax}</p>
          </div>
          <div className="flex justify-between">
            <p className="text-sm font-medium  ">Shipping Charges:</p>

            <p className="text-sm  font-semibold  text-right">${shipping}</p>
          </div>
          <div className="w-full h-[1px] bg-[#E9E9E9]"></div>
          <div className="flex justify-between">
            <p className="text-sm font-medium ">Total:</p>

            <p className="text-sm   font-semibold  text-right">
              ${total + tax + shipping}
            </p>
          </div>
        </div>

        {!confirm && (
          <Row className="justify-center mt-4">
            <Button
              type="primary"
              id="submit-order-button"
              className=" w-full sm:w-44 h-9 !bg-[#13188A]"
              onClick={async () => {
                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                    window.location.href = loginUrl;
                } else {
                  const saleAddresses = [];
                  const quantities = [];
                  data.forEach((item) => {
                      saleAddresses.push(item.saleAddress)
                      quantities.push(item.qty)
                  })
                  const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, saleAddresses, quantities)
                  if (checkQuantity === true ) {
                      // Proceed with order submission
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

                  } else {
                      let insufficientQuantityMessage = "";
                      let outOfStockMessage = "";

                      // Generate the messages of products with too little or no quantity
                      checkQuantity.forEach(detail => {
                          if (detail.availableQuantity === 0) {
                              outOfStockMessage += `Product ${detail.assetName}\n`;
                          } else {
                              insufficientQuantityMessage += `Product ${detail.assetName}: ${detail.availableQuantity}\n`;
                          }
                      });
                      
                      // Throw the appropriate error messages. Throw both if applicable. 
                      let errorMessage = "";
                      if (insufficientQuantityMessage) {
                          errorMessage += `The following item(s) in your cart have limited quantity available and will need to be adjusted. Please reduce the quantity to proceed:\n${insufficientQuantityMessage}`;
                      }
                      if (outOfStockMessage) {
                          if (errorMessage) errorMessage += "\n"; // Add a new line if there's already an error message
                          errorMessage += `The following item(s) are temporarily out of stock and should be removed:\n${outOfStockMessage}`;
                      }
                      openToastOrder("bottom", errorMessage);
                  }
                }
              }}
              disabled={data.length === 0}
            >
            Submit & Checkout
            </Button>
          </Row>
        )}
      </div>
    </div>
  );
};

export default ResponsiveCart;
