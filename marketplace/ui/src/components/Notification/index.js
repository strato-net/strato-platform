import { useEffect, useState } from "react";
import NotifcationCard from "./NotificationCard";
import useWebSocket from "react-use-websocket";

const Notification = () => {
    function constructEndpoint(){
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:" ;
        const port = window.location.port ? ":" + window.location.port : "" ;
        return wsProtocol + "//" + window.location.hostname + port + "/eventstream" ;
    }

    function myFilter(message) {
        const event = JSON.parse(message.data);
        return event?.eventEvent?.eventName === "OwnershipUpdate";
    }
    const { lastMessage } = useWebSocket(constructEndpoint(), {
        share: true,
        filter: myFilter,
        shouldReconnect: (closeEvent) => {
            console.log("going to reconnect after closeEvent ", closeEvent);
            return true},
        onOpen: () => console.log("websocket opened"),
        onClose: () => console.log("websocket closed"),
        onError: (err) => console.log("websocket error: ", err)
    })
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        if (lastMessage !== null) {
            const newEvent = JSON.parse(lastMessage.data);
            console.log("new message: ", newEvent);
            setNotifications((prevNotif) => {if (prevNotif.length < 20) return prevNotif.concat(newEvent); else return prevNotif});
        }
    }, [lastMessage, setNotifications]);

    return (
        <div>
            {notifications.length > 0 ? (
                <div className="flex flex-wrap my-4 gap-8">
                    {notifications.map((notif) => {
                        return (
                            <NotifcationCard
                                notification={notif}
                            />
                        );
                    })}
                </div>
            ) : (
                <p className="flex justify-center my-10"> No data found</p>
            )}
        </div>
    )
}


export default Notification;