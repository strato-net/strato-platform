import axios from 'axios';
import { getUserToken } from '../auth';

const NODE_URL = process.env.NODE_URL;

export const fetchCirrusData = async (endpoint: string): Promise<any | null> => {
  const accessToken = await getUserToken();

  if (!accessToken) return null;
  
  try {
    const response = await axios.get(`${NODE_URL}/cirrus/search/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return response.data;
  } catch (error: any) {
    return null;
  }
};
