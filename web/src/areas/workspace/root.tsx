import { Surface } from "@/components/platform/surface";
import memberTheme from "@/styles/member-theme.module.css";
import { Shell } from "./shell/shell";
import styles from "./styles/surface.module.css";
export default function Root() {
  return (
    <Surface
      area="workspace"
      className={`${memberTheme.scope} ${styles.scope} ${chatStyles.root}`}
    >
      <Shell />
    </Surface>
  );
}
import chatStyles from "@/features/agents/chat/surface.module.css";
