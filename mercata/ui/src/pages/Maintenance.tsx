import { useTheme } from "next-themes";
import STRATOLOGO from "@/assets/strato.png";
import STRATOLOGODARK from "@/assets/strato-dark.png";

const Maintenance = () => {
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === "dark" ? STRATOLOGODARK : STRATOLOGO;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <img src={logo} alt="STRATO" className="h-10 mb-8" />
      <h1 className="text-3xl font-bold mb-3">Under Maintenance</h1>
      <p className="text-muted-foreground text-center max-w-md">
        We're currently performing scheduled maintenance. The platform will be
        back online shortly. Thank you for your patience.
      </p>
    </div>
  );
};

export default Maintenance;
