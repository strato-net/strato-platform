import React from 'react';
import { Modal, Button } from 'antd';

const LoginModal = ({ visible, onCancel, onLogin }) => {
    return (
        <Modal
            title="Login Required"
            open={visible}
            onCancel={onCancel}
            footer={[
                <Button key="back" onClick={onCancel}>
                    Cancel
                </Button>,
                <Button key="submit" type="primary" onClick={onLogin}>
                    Login
                </Button>,
            ]}
        >
            <p>You need to log in to continue. Would you like to log in now?</p>
        </Modal>
    );
};

export default LoginModal;
