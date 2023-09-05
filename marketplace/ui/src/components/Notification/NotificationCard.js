const NotifcationCard = ({notification}) => {
    console.log('AYAS LOGS PART TWOOOO', notification)
  
    return (
        <div>
        { notification ? (
        <div className="bg-white drop-shadow-md">
            <div className="flex flex-row">
                <p className="font-bold">
                    Event Name: {notification.eventEvent?.eventName}
                </p>
                {notification.eventBlockTimestamp ? 
                <p className="italic"> Event Time: {(new Date(notification.eventBlockTimestamp)).toString()} </p> 
                : null}
                <p>
                    From: {notification.eventTxSender}
                </p>
            </div>
        </div>)
        : null
        }
        </div>
    )
}


export default NotifcationCard;