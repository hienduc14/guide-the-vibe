import type { ReactNode } from "react";
import { Empty } from "./Empty";

export interface Column<T> {
  key: string;
  title: ReactNode;
  render: (row: T) => ReactNode;
  width?: string | number;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  empty = "Không có dữ liệu",
  onRowClick,
  selected,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  selected?: string;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={`${onRowClick ? "clickable" : ""}${selected === k ? " selected" : ""}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render(r)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
