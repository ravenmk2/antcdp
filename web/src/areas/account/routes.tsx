import { NotFound } from "@/app/not-found";
import { RegionError, RegionLoader } from "@/app/region-loader";
import { lazy } from "react";
import { type RouteObject } from "react-router";
const AccountPage = lazy(() =>
  import("@/areas/account/pages/account-page").then((m) => ({
    default: m.AccountPage,
  })),
);
const IntegrationsPage = lazy(() =>
  import("@/areas/account/pages/integrations").then((m) => ({
    default: m.IntegrationsPage,
  })),
);
const RemoteHostsPage = lazy(() =>
  import("@/areas/account/pages/remote-hosts").then((m) => ({
    default: m.RemoteHostsPage,
  })),
);
const Root = lazy(() => import("./root"));
export const accountRoutes: RouteObject[] = [
  {
    element: (
      <RegionLoader label="个人中心">
        <Root />
      </RegionLoader>
    ),
    errorElement: <RegionError label="个人中心" />,
    children: [
      { index: true, element: <AccountPage /> },
      { path: "security", element: <AccountPage /> },
      { path: "integrations/:connectionId?", element: <IntegrationsPage /> },
      { path: "remote-hosts/:hostId?", element: <RemoteHostsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
