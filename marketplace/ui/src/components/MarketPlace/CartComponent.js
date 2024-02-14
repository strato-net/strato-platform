import {
    Button,
    Row,
    Col,
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
import { actions as orderActions } from "../../contexts/order/actions"
import { useOrderDispatch } from "../../contexts/order";


const CartComponent = ({ columns, data, openToastOrder }) => {


    const navigate = useNavigate();
    const [tax, setTax] = useState(0);
    const [shipping, setShipping] = useState(0);
    const [innerWidth, setInnerWidth] = useState(0)
    const [total, setTotal] = useState(0);
    const marketplaceDispatch = useMarketplaceDispatch();
    const orderDispatch = useOrderDispatch();

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
        <>
            <div className="pt-2  ">
                <div>
                    <div className=" cart">
                        <DataTableComponent
                            isLoading={false}
                            scrollX={"100%"}
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
                                    <p className="text-base font-medium w-36 text-[#6A6A6A]">Tax:</p>
                                    <p className="text-[18px]  text-[#202020] ml-2 w-20 text-right">${tax}</p>
                                </Row>
                                <Row className="justify-end mt-2">
                                    <p className="text-base font-medium w-[150px]  text-[#6A6A6A]">Shipping Charges:</p>
                                    <p className="text-[18px]  text-[#202020] ml-2 w-20 text-right">${shipping}</p>
                                </Row>
                            </Col>
                        </Row>
                        {/* //As per the  design we have two display two time 'total value' */}
                        <Row className="flex   justify-evenly items-center pr-[51px] py-[18px]">
                            <div className="w-[1px] h-full bg-[#20202030] mx-5 "></div>
                            <div className="flex gap-5">
                                <p className="text-base font-semibold  w-36 text-[#6A6A6A] ">Total:</p>
                                <p className="text-lg font-semibold w-36  text-[#202020]">${total + tax + shipping}</p>
                            </div>

                            <Button
                                type="primary"
                                id="submit-order-button"
                                className="flex items-center px-4 py-5 bg-primary !hover:bg-primaryHover"
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
                                            let insufficientItemsMessage = "The following items may no longer be available in the desired quantities:\n";

                                            checkQuantity.forEach(detail => {
                                            insufficientItemsMessage += `(${detail.assetName}-Available Quantity: ${detail.availableQuantity})\n`;
                                            });

                                            openToastOrder("bottom", insufficientItemsMessage)
                                        }
                                    }
                                }}
                                disabled={data.length === 0}
                            >
                                Submit & Checkout
                            </Button>

                        </Row>
                    </div>
                </div>
            </div>
        </>
    );
}


export default CartComponent;