import { Navigate, useLocation, useParams } from "react-router";
export function RemovedProjectPage() {
  const { projectId } = useParams();
  const { pathname } = useLocation();
  return (
    <Navigate
      replace
      to={`${pathname.startsWith("/admin/") ? "/admin" : ""}/projects/${projectId}`}
    />
  );
}
