export function WorkspaceFileLabels({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <ul aria-label="工作区文件" className="flex flex-wrap gap-1.5">
      {names.map((name, index) => (
        <li
          key={index}
          className="rounded-md border px-2 py-0.5 text-xs break-all"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}
