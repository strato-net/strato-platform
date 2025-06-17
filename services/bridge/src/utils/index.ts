export async function getUserAddressFromToken(
  accessToken: string
): Promise<string> {

  const user = await fetch(
    `${process.env.NODE_URL}/strato/v2.3/key`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const userData: any = await user.json();
  return userData.address;
}
