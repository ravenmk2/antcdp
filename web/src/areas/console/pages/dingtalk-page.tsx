import { useParams } from "react-router";
import { ConsoleListPage } from "@/areas/console/components/list-page";
import { DingTalkPage as DingTalkFeaturePage } from "@/features/dingtalk/page";

export function DingTalkPage() {
  const { id } = useParams();
  return id ? (
    <DingTalkFeaturePage />
  ) : (
    <ConsoleListPage nested>
      <DingTalkFeaturePage />
    </ConsoleListPage>
  );
}
