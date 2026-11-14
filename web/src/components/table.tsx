import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataColumn<T> = ColumnDef<T, unknown>;

export function TableContainer({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("table-scroll", className)} {...props} />;
}

export function TableRoot({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("data-table", className)} {...props} />;
}

export function DataTable<T>({
  data,
  columns,
  label,
  rowKey,
  className,
  onRowClick,
  actionColumn,
  containerProps,
  rowProps,
  headerProps,
  cellProps,
}: {
  data: T[];
  columns: DataColumn<T>[];
  label: string;
  rowKey: (row: T) => string;
  className?: string;
  onRowClick?: (row: T) => void;
  actionColumn?: string;
  containerProps?: ComponentProps<"div">;
  rowProps?: (row: T) => ComponentProps<"tr">;
  headerProps?: (columnId: string) => ComponentProps<"th">;
  cellProps?: (row: T, columnId: string) => ComponentProps<"td">;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: rowKey,
  });
  return (
    <TableContainer {...containerProps}>
      <TableRoot className={className} aria-label={label}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  data-align={
                    header.column.id === actionColumn ? "right" : undefined
                  }
                  {...headerProps?.(header.column.id)}
                >
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
              {...rowProps?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  data-align={
                    cell.column.id === actionColumn ? "right" : undefined
                  }
                  {...cellProps?.(row.original, cell.column.id)}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableRoot>
    </TableContainer>
  );
}

export function SimpleTable({
  headers,
  children,
  label,
  className,
  actions = false,
  containerProps,
  headerProps,
}: {
  headers: ReactNode[];
  children: ReactNode;
  label: string;
  className?: string;
  actions?: boolean;
  containerProps?: ComponentProps<"div">;
  headerProps?: (index: number) => ComponentProps<"th">;
}) {
  return (
    <TableContainer {...containerProps}>
      <TableRoot
        className={cn("data-table", actions && "has-action-column", className)}
        aria-label={label}
      >
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} scope="col" {...headerProps?.(index)}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </TableRoot>
    </TableContainer>
  );
}
