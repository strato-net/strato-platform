import {
    Button,
    Row,
    Divider,
    Col,
    Card
} from "antd";
import DataTableComponent from "../DataTableComponent";
import "./index.css";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { actions } from "../../contexts/marketplace/actions";
import {
    useMarketplaceDispatch,
  } from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";


const New_CartComponent = ({ columns, data }) => {


    const navigate = useNavigate();
    const [tax, setTax] = useState(0);
    const [shipping, setShipping] = useState(0);
    const [innerWidth ,  setInnerWidth] =  useState(0)
    const [total, setTotal] = useState(0);
    const marketplaceDispatch = useMarketplaceDispatch();

    let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();


    useEffect(() => {
        let t = 0;
        let s = 0;
        let tot = 0;
        data.forEach(element => {
            t += element.tax;
            s += element.shippingCharges;
            tot += element.amount;
        });
        setTax(t);
        setShipping(s);
        setTotal(tot)
    }, [data])
    useEffect(() => {
        // Update inner width when the window is resized
        const handleResize = () => {
          setInnerWidth(window.innerWidth);
        };
    
        window.addEventListener("resize", handleResize);
    
        return () => {
          // Cleanup the event listener on component unmount
          window.removeEventListener("resize", handleResize);
        };
      }, []);
    
   


    return (
        // <Card className="my-4">
        <>
            <div className="pt-10  ">
                <div>
                    <div className="mt-4  ">
                        <DataTableComponent
                          isLoading={false}
                            
                            // rowSelection={{
                            //   type: "checkbox",
                            //   ...rowSelection,
                            // }}
                            scrollX={"100%"}
                            
                            // scrollX={`${ innerWidth <= 1220 ? '110%' : innerWidth <= 1140 ? '120%' : "100%"}`}
                            columns={columns}
                            data={data}
                            pagination={false}
                        />
                    </div>

                    <div className="bg-[#EEEFFA]  rounded-b-md flex justify-between border-b border-l border-r  border-[#E9E9E9] ">
                    <Row className=" py-[15px] pl-14 xl:pl-20 ">
                        <Col>
                            <Row className="justify-end ">
                                <p className="text-base font-medium text-[#6A6A6A] w-36 ">Sub Total:</p>
                                
                                <p className="text-[18px]  text-[#202020] ml-2 w-20 text-right">${total}</p>
                            </Row>
                            <Row className="justify-end mt-2">
                                <p className="text-base font-medium w-36 text-[#6A6A6A]">Tax</p>
                              
                                <p className="text-[18px]  text-[#202020] ml-2 w-20 text-right">${tax}</p>
                            </Row>
                            <Row className="justify-end mt-2">
                                <p className="text-base font-medium w-36 text-[#6A6A6A]">Shipping Charges</p>
                              
                                <p className="text-[18px]  text-[#202020] ml-2 w-20 text-right">${shipping}</p>
                            </Row>
                          
                            <Row className="justify-end mt-2">
                                <p className="text-base font-medium w-36 text-[#6A6A6A]">Total</p>
                               
                                <p className="text-[18px]  text-[#202020] ml-2 w-20 text-right">
                                ${total + tax + shipping}
                                </p>
                            </Row>
                        </Col>
                    </Row>
                
                    <Row className="flex   justify-evenly items-center pr-[51px] py-[18px]">

                       <div className="w-[1px] h-[100%] bg-[#202020] mx-5 "></div>
                     <div className="flex gap-5">
                     <p className="text-base font-semibold  w-36 text-[#6A6A6A] ">Total:</p>
                     <p className="text-lg font-semibold w-36  text-[#202020]">${total + tax + shipping}</p>
                     </div>

                        <Button
                            type="primary"
                            id="submit-order-button"
                            className="w-[158px] h-9 bg-primary !hover:bg-primaryHover"
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
                          Submit & Checkout
                        </Button>

                    </Row>
                    </div>
                </div>
            </div>
        {/* </Card> */}
        </>
    );
}


export default New_CartComponent;