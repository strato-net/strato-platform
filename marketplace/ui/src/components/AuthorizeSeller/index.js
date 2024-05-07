import React from "react";
import { Button, Form, Input, Radio } from "antd";
import { actions } from "../../contexts/sellerStatus/actions";
import { useSellerStatusState, useSellerStatusDispatch } from "../../contexts/sellerStatus";

export default function AuthorizeSeller(){
    const { changingSellerStatus } = useSellerStatusState();
    const dispatch = useSellerStatusDispatch();
    const onFinish = async (values) => {
        console.log('AYAS LOGS - values', values);
        let resp = await actions.authorizeSeller(dispatch, values);
        console.log(resp);
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
            <Button type="primary" htmlType="submit" loading={changingSellerStatus}>
            Authorize Seller
            </Button>
        </Form>
    )
}