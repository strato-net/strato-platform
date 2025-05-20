import { cirrus } from "../../utils/mercataApiHelper";

// Get all users
export const getAll = async (accessToken: string) => {
  try {
    const response = await cirrus.get(accessToken, `/Certificate`);

    if (response.status !== 200) {
      throw new Error(`Error fetching users: ${response.statusText}`);
    }

    if (!response.data) {
      throw new Error("Users data is empty");
    }

    return response.data;
  } catch (error) {
    console.error("Error fetching users:", error);
    throw error;
  }
};
