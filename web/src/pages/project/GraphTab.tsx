import { useState } from "react";
import { api } from "../../api/endpoints";
import type { CallerHit, SymbolRow } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card, Stat } from "../../components/Card";
import { Badge } from "../../components/Badge";
import { Table } from "../../components/Table";
import { Empty, Loading } from "../../components/Empty";
import { shortSha } from "../../lib/format";
import { CodeMap } from "./CodeMap";

const CONF_TONE = { local: "solid", import: "strong", name: "default" } as const;

export function GraphTab() {
  const { id, detail } = useProject();
  const stats = usePoll(() => api.graph.stats(id), [id], 15_000);
  const state = usePoll(() => api.projects.state(id), [id], 15_000);
  const [view, setView] = useState("base");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState<string>();
  const symbols = usePoll(() => (query ? api.graph.symbols(id, query, view) : Promise.resolve([] as SymbolRow[])), [id, query, view], 0);
  const callers = usePoll(() => (symbol ? api.graph.callers(id, symbol, view) : Promise.resolve([])), [id, symbol, view], 0);

  const workspaces = (state.data?.workspaces ?? []).filter((w) => w.snapshot_sha);
  const hits: CallerHit[] = callers.data?.flatMap((c) => c.callers) ?? [];

  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="File" value={stats.data?.base.files ?? "—"} />
        <Stat label="Symbol" value={stats.data?.base.symbols ?? "—"} />
        <Stat label="Tham chiếu" value={stats.data?.base.refs ?? "—"} />
        <Stat
          label={`Commit ${detail.main_branch}`}
          value={
            <span className="mono" style={{ fontSize: "var(--text-lg)" }}>
              {shortSha(stats.data?.main)}
            </span>
          }
        />
      </div>

      <CodeMap projectId={id} view={view} />

      <Card title="Tra cứu symbol">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
            setSymbol(undefined);
          }}
        >
          <select className="select" style={{ width: "auto", minWidth: 180 }} value={view} onChange={(e) => setView(e.target.value)} aria-label="View">
            <option value="base">base (main)</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                WIP · {w.dev} · {w.label}
              </option>
            ))}
          </select>
          <input
            className="input mono"
            style={{ flex: 1, minWidth: 200 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="getUser · AuthService.login · src/auth/service.ts#getUser"
          />
          <button className="btn primary" type="submit" disabled={!q.trim()}>
            Tìm
          </button>
        </form>
        <p className="xs faint" style={{ marginTop: 8 }}>
          View “WIP” = code của workspace đó (snapshot chưa merge) chồng lên main. Graph dựng bằng tree-sitter, không dùng LLM.
        </p>
      </Card>

      {query && (
        <div className="split">
          <Card title="Symbol" flush>
            {!symbols.data ? (
              <Loading />
            ) : (
              <Table<SymbolRow>
                rows={symbols.data}
                rowKey={(s) => `${s.layer}:${s.id}`}
                selected={symbol ? `${symbols.data.find((s) => s.id === symbol)?.layer}:${symbol}` : undefined}
                onRowClick={(s) => setSymbol(s.id)}
                empty="Không tìm thấy symbol"
                columns={[
                  {
                    key: "s",
                    title: "Symbol",
                    render: (s) => (
                      <div className="stack tight" style={{ gap: 2 }}>
                        <span className="mono small">{s.qualname}</span>
                        <span className="xs faint mono wrap-anywhere">{s.sig}</span>
                      </div>
                    ),
                  },
                  { key: "k", title: "Loại", render: (s) => <Badge>{s.kind}</Badge> },
                  {
                    key: "at",
                    title: "Vị trí",
                    render: (s) => (
                      <span className="xs mono muted">
                        {s.path}:{s.start_line}
                      </span>
                    ),
                  },
                  { key: "l", title: "Lớp", render: (s) => <span className="xs mono">{s.layer}</span> },
                ]}
              />
            )}
          </Card>
          <Card title={symbol ? <h3 className="mono wrap-anywhere">Ai gọi {symbol.split("#")[1] ?? symbol}</h3> : "Ai gọi"} flush>
            {!symbol ? (
              <Empty>Chọn một symbol để xem nơi gọi</Empty>
            ) : !callers.data ? (
              <Loading />
            ) : (
              <Table<CallerHit>
                rows={hits}
                rowKey={(h) => `${h.layer}:${h.path}:${h.line}`}
                empty="Không có nơi gọi"
                columns={[
                  {
                    key: "at",
                    title: "Vị trí",
                    render: (h) => (
                      <span className="mono xs">
                        {h.path}:{h.line}
                      </span>
                    ),
                  },
                  { key: "in", title: "Trong", render: (h) => <span className="mono xs muted">{h.from_symbol?.split("#")[1] ?? "—"}</span> },
                  { key: "c", title: "Độ tin cậy", render: (h) => <Badge tone={CONF_TONE[h.confidence]}>{h.confidence}</Badge> },
                  { key: "l", title: "Lớp", render: (h) => <span className="xs mono">{h.layer}</span> },
                ]}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
