import { notification } from "antd";

export const showToast = ({ message, success, onClose, placement }) => {
  const api = notification;

  const config = {
    message: message,
    onClose: onClose,
    placement: placement,
    duration: 3,
  };

  if (success) {
    api.success({
      ...config,
      key: 1,
    });
  } else {
    api.error({
      ...config,
      key: 2,
    });
  }
};
