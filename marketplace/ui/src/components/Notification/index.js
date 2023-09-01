import { useEffect, useState } from "react";
import { Tabs, Input, Button } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import ActiveTab from "./ActiveTab";
import InactiveTab from "./InactiveTab";
import useWebSocket from "react-use-websocket";

const Notification = () => {
    const { Search } = Input;
    // const endpoint = `${process.env.REACT_APP_URL}/eventstream`
    // console.log(endpoint)
    const endpoint = "ws://localhost/eventstream"; //TODO: how to make this more flexible?
    const { lastMessage, getWebSocket, sendMessage } = useWebSocket(endpoint, {
        share: true,
        shouldReconnect: (closeEvent) => {
            console.log("going to reconnect after closeEvent ", closeEvent);
            return true},
        onOpen: () => console.log("websocket opened"),
        onClose: () => console.log("websocket closed"),
        onError: (err) => console.log("websocket error: ", err)
    })
    const [notifications, setNotifications] = useState([]);
    // console.log("notifications, ", notifications);
    console.log(getWebSocket());


    useEffect(() => {
        if (lastMessage !== null) {
            const newEvent = JSON.parse(lastMessage.data);
            console.log("new message: ", newEvent);
            setNotifications((prevNotif) => prevNotif.concat(newEvent));
            console.log("notifications: ", notifications);
        }
    }, [lastMessage, setNotifications]);

    const items = [
        {
            key: "1",
            label: "Active",
            children: <ActiveTab products={[]} />
        },
        {
            key: "2",
            label: "Inactive",
            children: <InactiveTab products={[]} />
        }
    ]

    return (
        <>
            <div className="flex mx-16">
                <Tabs items={items} defaultActiveKey="1" className="mt-6" />
            </div>
            <div className="absolute top-28 right-32">
                <Search
                    className="w-96"
                    placeholder="Search by any Keyword"
                    enterButton="Search"
                    prefix={<SearchOutlined style={{ color: "#989898" }} />}
                />
                <Button
                    className="w-32 ml-12"
                    type="primary"
                >
                    Filter
                </Button>
            </div>
        </>
    )
}


export default Notification;