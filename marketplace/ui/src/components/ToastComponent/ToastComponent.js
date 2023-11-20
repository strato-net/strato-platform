import { useEffect } from "react";
import { notification } from "antd";

const ToastComponent = ({ message, success, onClose, placement }) => {
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    if (message) {
      let obj = {
        message: message,
        onClose: onClose,
        placement: placement,
      }
      if (success) {
        api.success({
          ...obj,
          key: 1,
        });
      } else {
        api.error({
          ...obj,
          key: 2,
        });
      }
    }
  }, [message, success, onClose, placement]);

  return contextHolder;
};

export default ToastComponent;
