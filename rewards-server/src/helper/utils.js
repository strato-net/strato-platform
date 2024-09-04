export const sendEmail = async (baseUrl, type, userName, token) =>{
  try {
    const purchaseRewardMailRes = await axios.post(`http://localhost/api/v1/notification/${type}`,
      { user: userName },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );
  } catch (error) {
    console.log("error", error);
  }
}

export const getUserName = async (baseUrl, address, token) => {
  try {
    const res = await axios.get(
      `https://${baseUrl}/cirrus/search/Certificate?userAddress=eq.${address}`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );
  
    return res.data[0].commonName;
  } catch (error) {
    console.log("error", error);
  }

}
