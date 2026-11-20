import { Surface } from "@/components/platform/surface";
import { Shell } from "./shell/shell";
import { ConsoleThemeProvider } from "./shell/theme";
import styles from "./styles/surface.module.css";
export default function Root() {
  return (
    <ConsoleThemeProvider>
      <Surface area="console" className={`${styles.scope} ${chatStyles.root}`}>
        <Shell />
      </Surface>
    </ConsoleThemeProvider>
  );
}
import chatStyles from "@/features/agents/chat/surface.module.css";
