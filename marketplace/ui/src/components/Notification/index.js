import { useEffect, useState } from "react";
import NotifcationCard from "./NotificationCard";
import { useEventStream } from "../../helpers/websocket";

const Notification = () => {
    

    function ownershipUpdateFilter(message) {
        const event = JSON.parse(message.data);
        return event?.eventEvent?.eventName === "OwnershipUpdate";
    }
    const { lastMessage } = useEventStream((msg) => JSON.parse(msg.data)?.eventEvent?.eventName === "CertificateRegistered");
    const { lastMessage: lastOwnershipUpdate } = useEventStream(ownershipUpdateFilter)
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        if (lastMessage !== null) {
            const newEvent = JSON.parse(lastMessage.data);
            console.log("new message: ", newEvent);
            setNotifications((prevNotif) => {if (prevNotif.length > 20) return prevNotif; else return prevNotif.concat(newEvent)});
        }
    }, [lastMessage, setNotifications]);

    useEffect(() => {
        if (lastOwnershipUpdate !== null) {
            const newOU = JSON.parse(lastOwnershipUpdate.data);
            console.log("ownership update");
            setNotifications((prevNotif) => {if (prevNotif.length > 20) return prevNotif; else return prevNotif.concat(newOU)});
        }
    }, [lastOwnershipUpdate, setNotifications]);

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