import { Modal } from "antd"

const IdleModal = ({ isOpen, stay, logout }) => {
    return (
        <Modal
            title="Your session is about to expire"
            open={isOpen}
            onOk={logout}
            onCancel={stay}
            cancelButtonProps={{ style: { color: "#000000" } }}
            okText="Sign out now"
            cancelText="Stay signed in"
        >
            <div>
                Do you want to stay signed in?
            </div>
        </Modal>
    )
}


export default IdleModal