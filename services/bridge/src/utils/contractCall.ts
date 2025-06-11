import axios from "axios";
import { getUserToken } from "../auth";

export const contractCall = async (
  contractName: string,
  contractAddress: string,
  method: string,
  args: any,
) => {
  const accessToken = await getUserToken();

  const txPayload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress,
          method,
          args,
        },
        type: "FUNCTION",
      },
    ],
    txParams: {
      gasLimit: 150000,
      gasPrice: 30000000000,
    },
  };

  const response = await axios.post(
    `${process.env.NODE_URL}/strato/v2.3/transaction/parallel?resolve=true`,
    txPayload,
    {
      headers: {
        accept: "application/json;charset=utf-8",
        "content-type": "application/json;charset=utf-8",
        authorization: `Bearer ${accessToken}`,
      },
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
    }
  );
  return response.data[0];
  
};
