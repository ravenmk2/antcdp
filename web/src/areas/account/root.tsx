import { Surface } from "@/components/platform/surface";
import memberTheme from "@/styles/member-theme.module.css";
import { Shell } from "./shell/shell";
import styles from "./styles/surface.module.css";
export default function Root() {
  return (
    <Surface area="account" className={`${memberTheme.scope} ${styles.scope}`}>
      <Shell />
    </Surface>
  );
}
