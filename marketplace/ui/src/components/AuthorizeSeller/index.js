import React from "react";
import { Button, Form, Input, Radio, notification } from "antd";
import { actions } from "../../contexts/sellerStatus/actions";
import { useSellerStatusState, useSellerStatusDispatch } from "../../contexts/sellerStatus";

export default function AuthorizeSeller(){
    const { changingSellerStatus, success, message } = useSellerStatusState();
    const dispatch = useSellerStatusDispatch();
    const onFinish = async (values) => {
        const { commonName, setStatusTo } = values;
        let resp;
        if (setStatusTo === 'Authorized') {
            resp = await actions.authorizeSeller(dispatch, { commonName });
        } else {
            resp = await actions.deauthorizeSeller(dispatch, { commonName });
        }
        console.log(resp);
    }

    const [api, contextHolder] = notification.useNotification();
    const openToast = (placement) => {
        if (success) {
            api.success({
            message: message,
            onClose: actions.resetMessage(dispatch),
            placement,
            key: 1,
            });
        } else {
            api.error({
            message: message,
            onClose: actions.resetMessage(dispatch),
            placement,
            key: 2,
            });
        }
        };

    return (
        <>
        {contextHolder}
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
            <Form.Item label="Seller's username" name="commonName">
                <Input/>
            </Form.Item> 
            <Form.Item label="Set seller status to" name="setStatusTo">
                <Radio.Group>
                    <Radio.Button value='Authorized'>Authorized</Radio.Button>
                    <Radio.Button value='Deauthorized'>Deauthorized</Radio.Button>
                </Radio.Group>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={changingSellerStatus}>
            Change Seller Status
            </Button>
        </Form>
        {message && openToast("bottom")}
        </>
    )
}