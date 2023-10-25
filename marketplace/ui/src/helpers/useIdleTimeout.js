import { useState } from "react"
import { useIdleTimer } from "react-idle-timer"
import { actions } from "../contexts/authentication/actions";
import { useAuthenticateDispatch, useAuthenticateState } from "../contexts/authentication";

export const useIdleTimeout = ({ onIdle, idleTime }) => {
    const authDispatch = useAuthenticateDispatch();
    const { user } = useAuthenticateState();
    const idleTimeout = 60000 * idleTime;
    const [isIdle, setIdle] = useState(false);
    const handleIdle = () => {
        if (user) {
            setIdle(true);
            actions.logout(authDispatch);
        }
    }
    const idleTimer = useIdleTimer({
        timeout: idleTimeout,
        promptBeforeIdle: idleTimeout - 600000,   // timeout minus 10 minutes
        onPrompt: onIdle,
        onIdle: handleIdle,
        debounce: 500
    })
    return {
        isIdle,
        setIdle,
        idleTimer
    }
}