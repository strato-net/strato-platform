import { jwtDecode } from "jwt-decode";

export async function getUserAddressFromToken(
  accessToken: string
): Promise<string> {
  const decoded = jwtDecode(accessToken);
  const userName = decoded.sub;

  const user = await fetch(
    `${process.env.NODE_URL}/strato/v2.3/key?username=${userName}`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const userData: any = await user.json();
  // return userData.address;
  return '1b7dc206ef2fe3aab27404b88c36470ccf16c0ce';
}


