import { Surface } from "@/components/platform/surface";
import { Shell } from "./shell/shell";
import styles from "./styles/surface.module.css";
export default function Root() {
  return (
    <Surface area="console" className={`${styles.scope} ${chatStyles.root}`}>
      <Shell />
    </Surface>
  );
}
import chatStyles from "@/features/agents/chat/surface.module.css";
