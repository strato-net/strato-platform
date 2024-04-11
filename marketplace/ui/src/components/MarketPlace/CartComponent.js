import {
    Button,
    Row,
    Col,
    Modal,
    Spin
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
import { setCookie } from "../../helpers/cookie";


const CartComponent = ({ columns, data, openToastOrder }) => {
    const navigate = useNavigate();
    const [tax, setTax] = useState(0);
    const [shipping, setShipping] = useState(0);
    const [innerWidth, setInnerWidth] = useState(0)
    const [total, setTotal] = useState(0);
    const marketplaceDispatch = useMarketplaceDispatch();
    const orderDispatch = useOrderDispatch();
    const [modal, contextHolder] = Modal.useModal();

    const countDown = () => {
        modal.info({
            okButtonProps: { hidden: true },
            content: (
                <>
                    <p className="font-medium">
                        In order to proceed with your purchase, you will first need to log in or register an account with Mercata.
                    </p>
                    <br />
                    <p>
                        You will be redirected to the sign-in page shortly.
                    </p>
                    <Spin className="flex justify-center mt-2" />
                </>
            ),
        });
        setTimeout(() => {
            setCookie("returnUrl", `/confirmOrder`, 10);
            window.location.href = loginUrl;
        }, 4000);
    };

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
            {contextHolder}
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
                                    const saleAddresses = [];
                                    const quantities = [];
                                    data.forEach((item) => {
                                        saleAddresses.push(item.saleAddress)
                                        quantities.push(item.qty)
                                    })
                                    const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, saleAddresses, quantities)
                                    if (checkQuantity === true) {
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

                                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                            countDown();
                                        } else {
                                            navigate("/confirmOrder");
                                            window.scrollTo(0, 0);
                                        }

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
                                }}
                                disabled={data.length === 0}
                            >
                                Submit & Checkout1
                            </Button>

                        </Row>
                    </div>
                </div>
            </div>
        </>
    );
}


export default CartComponent;