import { UserRound } from "lucide-react";
export function Avatar({
  url,
  name,
  large = false,
}: {
  url?: string | null;
  name: string;
  large?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted font-medium text-muted-foreground ${large ? "size-16 text-xl" : "size-9 text-sm"}`}
    >
      {url ? (
        <img
          className="h-full w-full object-cover"
          src={url}
          alt={`${name}的头像`}
        />
      ) : (
        <UserRound aria-hidden="true" className={large ? "size-7" : "size-4"} />
      )}
    </span>
  );
}
