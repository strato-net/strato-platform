import { useEffect } from "react";
import {
  Spin,
  notification,
} from "antd";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState
} from "../../contexts/inventory";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";

const OnboardingIntermediate = () => {

  const dispatch = useInventoryDispatch();
  const { message } = useInventoryState();
  const [api, contextHolder] = notification.useNotification();
  const navigate = useNavigate();

  const onboardSeller = async () => {
    let data = await actions.onboardSellerToStripe(dispatch);
    if (data != null && data.url !== undefined) {
      window.location.replace(data.url)
    }else{
      setTimeout(function () {
        navigate(routes.Inventories.url)
      }, 2000);
    }
  }

  const openToastMarketplace = (placement) => {
    if (message!=null) {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  useEffect(() => {
    onboardSeller();
  }, []);

  return <div>
    {contextHolder}
    <div className="h-96 flex flex-col justify-center items-center">
      <Spin spinning={true} size="large" />
      <p className="mt-4">Please wait while we connect you to stripe</p>
    </div>
    {message && openToastMarketplace("bottom")}
  </div>
}

export default OnboardingIntermediate;