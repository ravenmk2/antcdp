import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataColumn<T> = ColumnDef<T, unknown>;

export function DataTable<T>({
  data,
  columns,
  label,
  rowKey,
  className,
  onRowClick,
}: {
  data: T[];
  columns: DataColumn<T>[];
  label: string;
  rowKey: (row: T) => string;
  className?: string;
  onRowClick?: (row: T) => void;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="table-scroll">
      <table className={cn("data-table", className)} aria-label={label}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={rowKey(row.original)}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={onRowClick ? "cursor-pointer" : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimpleTable({
  headers,
  children,
  label,
  className,
}: {
  headers: ReactNode[];
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className="table-scroll">
      <table className={cn("data-table", className)} aria-label={label}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
