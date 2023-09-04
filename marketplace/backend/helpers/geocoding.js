import axios from "axios";

export const geocodeAddress = async (address) => {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`;
  const params = {
    access_token: process.env.MAPBOX_ACCESS_TOKEN,
  };

  try {
    const response = await axios.get(url, { params });
    
    if (response.status === 200) {
      const data = response.data;
      console.log('data-geo', data)
      if (data.features && data.features.length > 0) {
        const firstResult = data.features[0];
        const coordinates = firstResult.geometry.coordinates;
        return coordinates;
      } else {
        return null;
      }
    } else {
      console.error(`Geocoding request failed with status code ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error('Error while making the geocoding request:', error);
    return null;
  }
}