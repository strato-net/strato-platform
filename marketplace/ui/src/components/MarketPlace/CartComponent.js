import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TagManager from "react-gtm-module";
import {
    Button,
    Row,
    Divider,
    Col,
    Card
} from "antd";

import DataTableComponent from "../DataTableComponent";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useAuthenticateState } from "../../contexts/authentication";
import { useMarketplaceDispatch } from "../../contexts/marketplace";
import "./index.css";

const CartComponent = ({ columns, data, index }) => {
    const navigate = useNavigate();
    const marketplaceDispatch = useMarketplaceDispatch();
    let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

    const [shipping, setShipping] = useState(0);
    const [total, setTotal] = useState(0);
    const [tax, setTax] = useState(0);

    useEffect(() => {
        let t = 0;
        let s = 0;
        let tot = 0;
        data.forEach(element => {
            t += ((parseFloat(element.tax)));
            s += (parseFloat(element.shippingCharges));
            tot += (element.unitPrice * element.qty)
        });
        setTax(t);
        setShipping(s);
        setTotal(tot)
    }, [data])
    let totalNew = 0;
    data.forEach(element => { totalNew += (element.amount + element.tax); });

    const finalTotal = (total + tax + shipping).toFixed(2);
    //To future dev, amount_ is for the column amount in the table, it includes tax
    //Why total uses amount
    columns[8].dataIndex = "amount";

    // data.forEach(element => {
    //     element.amount_ = !element.isTaxPercentage ? element.amount * (1 + parseFloat(element.tax) / 10000) : element.amount + parseFloat(element.tax)
    // });

    return (
        <Card className="my-4" key={index}>
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
                                <p className="text-lg font-semibold">:</p>
                                <p className="text-lg font-semibold ml-2 w-20 text-right">
                                    ${finalTotal}
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
                                    marketplaceActions.addItemToConfirmOrder(marketplaceDispatch, data);
                                    TagManager.dataLayer({
                                        dataLayer: {
                                            event: 'submit_order_from_cart',
                                        },
                                    });
                                    navigate("/confirmOrder");
                                }
                            }}
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
