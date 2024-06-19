import React from "react";
import { Button, Form, Input, Radio, notification } from "antd";
import { actions } from "../../contexts/issuerStatus/actions";
import { useIssuerStatusState, useIssuerStatusDispatch } from "../../contexts/issuerStatus";

export default function AuthorizeIssuer(){
    const { changingIssuerStatus, changingAdminStatus, success, message } = useIssuerStatusState();
    const dispatch = useIssuerStatusDispatch();
    const onFinish = async (values) => {
        const { commonName, setStatusTo } = values;
        if (setStatusTo === 'Authorized') {
            await actions.authorizeIssuer(dispatch, { commonName });
        } else {
            await actions.deauthorizeIssuer(dispatch, { commonName });
        }
    }
    const onFinishAdmin = async (values) => {
        const { commonName, setStatusTo } = values;
        if (setStatusTo === 'Add') {
            await actions.modifyAdmin(dispatch, { commonName, b: true });
        } else {
            await actions.modifyAdmin(dispatch, { commonName, b: false });
        }
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
                Change Issuer's Authorization Status
            </p>
            <Form.Item label="Username" name="commonName">
                <Input/>
            </Form.Item> 
            <Form.Item label="Set issuer status to" name="setStatusTo">
                <Radio.Group>
                    <Radio.Button value='Authorized'>Authorized</Radio.Button>
                    <Radio.Button value='Deauthorized'>Deauthorized</Radio.Button>
                </Radio.Group>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={changingIssuerStatus}>
            Change Issuer Status
            </Button>
        </Form>
        
        <Form 
            onFinish={onFinishAdmin} 
            style={{
                padding: '5%',
                margin: 'auto',
                maxWidth: '50em',
            }}
        >
            <p className="text-base md:text-l lg:text-2xl font-bold lg:font-semibold leading-9">
                Add or Remove an Issuer Approver
            </p>
            <Form.Item label="Username" name="commonName">
                <Input/>
            </Form.Item> 
            <Form.Item label="Action" name="setStatusTo">
                <Radio.Group>
                    <Radio.Button value='Add'>Add</Radio.Button>
                    <Radio.Button value='Remove'>Remove</Radio.Button>
                </Radio.Group>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={changingAdminStatus}>
            Change Issuer Approver Status
            </Button>
        </Form>
        {message && openToast("bottom")}
        </>
    )
}