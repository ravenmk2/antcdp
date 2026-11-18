import { Surface } from "@/components/platform/surface";
import { useMatch } from "react-router";
import chatStyles from "@/features/agents/chat/surface.module.css";
import memberTheme from "@/styles/member-theme.module.css";
import { Shell } from "./shell/shell";
import styles from "./styles/surface.module.css";
export default function Root() {
  const conversation = useMatch("/chats/*");
  return (
    <Surface
      area="workspace"
      className={`${memberTheme.scope} ${styles.scope} ${chatStyles.root} ${conversation ? "" : styles.business}`}
    >
      <Shell />
    </Surface>
  );
}
