import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/context/UserContext";
import { useMyUserWallets } from "@/services/userWallets";

const DIRECT = "__direct__";

/**
 * Dropdown of the connected account's User wallets. The selected username routes the
 * transaction through that wallet (createContract/callContract); "Direct" sends it
 * straight from the connected account. `value` is the username ("" = direct).
 */
export function WalletSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (username: string) => void;
}) {
  const { userAddress } = useUser();
  const { data: wallets } = useMyUserWallets(userAddress);
  const options = (wallets ?? []).filter((w) => w.username);

  return (
    <Select value={value || DIRECT} onValueChange={(v) => onChange(v === DIRECT ? "" : v)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DIRECT}>Direct (no wallet)</SelectItem>
        {options.map((w) => (
          <SelectItem key={w.address} value={w.username}>
            {w.username}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
