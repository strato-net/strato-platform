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


const CartComponent = ({ columns, data }) => {
    const navigate = useNavigate();
    const [tax, setTax] = useState(0);
    const [shipping, setShipping] = useState(0);
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


    return (
        <Card className="my-4">
            <div>
                <div>
                    <div className="mt-4">
                        <DataTableComponent
                            isLoading={false}
                            // rowSelection={{
                            //   type: "checkbox",
                            //   ...rowSelection,
                            // }}
                            scrollX="100%"
                            columns={columns}
                            data={data}
                            pagination={false}
                        />
                    </div>
                    <Row className="justify-end mt-4">
                        <Col>
                            <Row className="justify-end4">
                                <p className="text-sm w-36 mr-2">Item Total</p>
                                <p className="text-sm">-</p>
                                <p className="text-sm ml-2 w-20 text-right">${total}</p>
                            </Row>
                            <Row className="justify-end mt-0.5">
                                <p className="text-sm w-36 mr-2">Tax</p>
                                <p className="text-sm">-</p>
                                <p className="text-sm ml-2 w-20 text-right">${tax}</p>
                            </Row>
                            <Row className="justify-end mt-0.5">
                                <p className="text-sm w-36 mr-2">Shipping Charges</p>
                                <p className="text-sm">-</p>
                                <p className="text-sm ml-2 w-20 text-right">${shipping}</p>
                            </Row>
                            <Divider />
                            <Row className="justify-end">
                                <p className="text-lg font-semibold w-36 mr-2">Total</p>
                                <p className="text-lg font-semibold">-</p>
                                <p className="text-lg font-semibold ml-2 w-20 text-right">
                                    ${total + tax + shipping}
                                </p>
                            </Row>
                        </Col>
                    </Row>
                    <Row className="justify-center mt-12">
                        <Button
                            type="primary"
                            id="submit-order-button"
                            className="w-44 h-9 bg-primary !hover:bg-primaryHover"
                            onClick={() => {
                                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                    window.location.href = loginUrl;
                                } else {
                                actions.addItemToConfirmOrder(marketplaceDispatch, data);
                                navigate("/marketplace/confirmOrder");
                            }}}
                            disabled={data.length === 0}
                        >
                            Submit Order
                        </Button>
                    </Row>
                </div>
            </div>
        </Card>
    );
}


export default CartComponent;