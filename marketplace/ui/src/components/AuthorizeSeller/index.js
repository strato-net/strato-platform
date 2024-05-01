import React from "react";
import { Button, Form, Input, Radio } from "antd";
import { actions } from "../../contexts/sellerStatus/actions";
import { useSellerStatusState, useSellerStatusDispatch } from "../../contexts/sellerStatus";

export default function AuthorizeSeller(){
    const dispatch = useSellerStatusDispatch();
    const onFinish = async (values) => {
        console.log('AYAS LOGS - values', values);
        await actions.authorizeSeller(dispatch, values);
    }
    return (
        <Form 
            onFinish={onFinish} 
            style={{
                padding: '5%',
                margin: 'auto',
                maxWidth: '50em',
            }}
        >
            <p className="text-base md:text-l lg:text-2xl font-bold lg:font-semibold leading-9">
                Change Seller's Authorization Status
            </p>
            <Form.Item label="Seller's Common Name" name="commonName">
            <Input/>
            </Form.Item> 
            <Button type="primary" htmlType="submit">
            Authorize Seller
            </Button>
        </Form>
    )
}