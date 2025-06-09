import axios from 'axios';
import { getUserToken } from '../auth';
import { getUserAddressFromToken } from '../utils';

const NODE_URL = process.env.NODE_URL;

export const fetchDepositInitiatedStatus = async ( status: string): Promise<any | null> => {
  const accessToken = await getUserToken();
  const userAddress = await getUserAddressFromToken(accessToken);
  if (!accessToken) return null;
  try {
    const response = await axios.get(`${NODE_URL}/cirrus/search/MercataEthBridge.${status}?mercataUser=eq.${userAddress}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return response.data;
  } catch (error: any) {
    return null;
  }
};

export const fetchDepositCompletedStatus = async (): Promise<any | null> => {
  const accessToken = await getUserToken();
  if (!accessToken) return null;
  try {
    const response = await axios.get(`${NODE_URL}/cirrus/search/MercataEthBridge.DepositCompleted`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error: any) {
    return null;
  }
} 

export const fetchWithdrawalInitiatedStatus = async (status: string): Promise<any | null> => {
  const accessToken = await getUserToken();
  const userAddress = await getUserAddressFromToken(accessToken);
  if (!accessToken) return null;
  
  try {
    const response = await axios.get(`${NODE_URL}/cirrus/search/MercataEthBridge.${status}?mercataUser=eq.${userAddress}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return response.data;
  } catch (error: any) {
    return null;
  }
};

export const fetchWithdrawalStatus = async (status: string): Promise<any | null> => {
  const accessToken = await getUserToken();
  if (!accessToken) return null;
  
  try {
    const response = await axios.get(`${NODE_URL}/cirrus/search/MercataEthBridge.${status}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return response.data;
  } catch (error: any) {
    return null;
  }
};


export const fetchDepositInitiated = async (txHash: string): Promise<any | null> => {
  const accessToken = await getUserToken();

  if (!accessToken) return null;
  try {
    const depositInitiatedResponse = await axios.get(`${NODE_URL}/cirrus/search/MercataEthBridge.DepositInitiated?txHash=eq.${txHash}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return depositInitiatedResponse.data;
  } catch (error: any) {
    return null;
  }
}; 