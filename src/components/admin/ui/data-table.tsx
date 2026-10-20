import {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  Rows3,
  Search,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react"

// Bulk action a page can attach — receives the currently-selected rows.
export interface BulkAction<TData> {
  label: string
  icon?: LucideIcon
  onSelected: (rows: TData[]) => void
  destructive?: boolean
}

// A one-tap preset filter (e.g. "High-risk orders", "Pending KYC").
export interface PresetView {
  id: string
  label: string
  filter?: string
}

interface SavedView {
  name: string
  globalFilter: string
  sorting: SortingState
  columnVisibility: VisibilityState
  pageSize: number
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchKey?: string
  searchPlaceholder?: string
  exportFilename?: string
  renderMobileCard?: (row: TData) => React.ReactNode
  // ── Optional enterprise features (all default off → existing usages unchanged) ──
  bulkActions?: BulkAction<TData>[]
  getRowId?: (row: TData) => string
  presetViews?: PresetView[]
  /** Enable named saved views persisted to localStorage under this key. */
  savedViewsKey?: string
  onRowClick?: (row: TData) => void
}

const PAGE_SIZE_KEY = "dt-page-size"
const PAGE_SIZES = [10, 25, 50, 100]

/** The operator's last page-size choice, shared by every table (default 25). */
function readPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY))
    return PAGE_SIZES.includes(n) ? n : 25
  } catch {
    return 25
  }
}
function writePageSize(n: number) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(n))
  } catch {
    /* private mode — the choice just isn't remembered */
  }
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("button, a, input, select, textarea, label, [role=menuitem], [role=checkbox], [role=switch], [data-row-click-ignore]")
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder,
  exportFilename,
  renderMobileCard,
  bulkActions,
  getRowId,
  presetViews,
  savedViewsKey,
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [compact, setCompact] = useState(false)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: readPageSize(),
  })
  const [searchParams] = useSearchParams()
  const [globalFilter, setGlobalFilter] = useState(
    () => searchParams.get("search") ?? ""
  )
  const urlSearch = searchParams.get("search")
  useEffect(() => {
    if (urlSearch !== null) setGlobalFilter(urlSearch)
  }, [urlSearch])

  // 29 tables passed a searchPlaceholder ("Search settlements…") without a
  // searchKey, so the search box they asked for never rendered. Either prop
  // now turns it on; the global filter searches every column regardless.
  const showSearch = !!searchKey || searchPlaceholder !== undefined
  const searchLabel = searchPlaceholder ?? "Search…"

  const selectable = Array.isArray(bulkActions) && bulkActions.length > 0

  // Prepend a selection column when bulk actions are enabled.
  const tableColumns = useMemo<ColumnDef<TData, TValue>[]>(() => {
    if (!selectable) return columns
    const selectCol: ColumnDef<TData, TValue> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
          className="translate-y-[1px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
          className="translate-y-[1px]"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }
    return [selectCol, ...columns]
  }, [columns, selectable])

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    enableRowSelection: selectable,
    getRowId,
    autoResetPageIndex: false,
    autoResetExpanded: false,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
      globalFilter,
    },
  })

  // ── Saved views (localStorage) ──
  const storeKey = savedViewsKey ? `dt-views:${savedViewsKey}` : ""
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [newViewName, setNewViewName] = useState("")
  useEffect(() => {
    if (!storeKey) return
    try {
      const raw = localStorage.getItem(storeKey)
      if (raw) setSavedViews(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [storeKey])
  const persist = (views: SavedView[]) => {
    setSavedViews(views)
    try {
      if (storeKey) localStorage.setItem(storeKey, JSON.stringify(views))
    } catch {
      /* ignore */
    }
  }
  const applyView = (v: Partial<SavedView>) => {
    setGlobalFilter(v.globalFilter ?? "")
    if (v.sorting) setSorting(v.sorting)
    if (v.columnVisibility) setColumnVisibility(v.columnVisibility)
    if (v.pageSize) table.setPageSize(v.pageSize)
    table.setPageIndex(0)
  }
  const saveCurrentView = () => {
    const name = newViewName.trim()
    if (!name) return
    persist([
      ...savedViews.filter((v) => v.name !== name),
      { name, globalFilter, sorting, columnVisibility, pageSize: pagination.pageSize },
    ])
    setNewViewName("")
  }

  const exportToCSV = () => {
    const cols = table.getVisibleLeafColumns().filter((c) => c.id !== "actions" && c.id !== "select")
    const headers = cols.map((col) => String(col.columnDef.header || col.id))
    const rows = table.getFilteredRowModel().rows.map((row) =>
      cols.map((col) => {
        const val = row.getValue(col.id)
        return val === null || val === undefined ? "" : String(val)
      })
    )
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportFilename || "export"}-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredRowCount = table.getFilteredRowModel().rows.length
  const totalRowCount = data.length
  const currentPage = table.getState().pagination.pageIndex + 1
  const totalPages = table.getPageCount()
  const selectedRows = table.getFilteredSelectedRowModel().rows.map((r) => r.original)
  const cellPad = compact ? "py-1.5 px-3" : "py-3 px-4"

  const hasViews = !!(presetViews?.length || savedViewsKey)

  // "No results" used to read the same whether the list was empty or the
  // search had filtered everything out — and offered no way back.
  const EmptyRows = () =>
    totalRowCount > 0 && globalFilter ? (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Nothing matches “{globalFilter}”.</p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setGlobalFilter("")}>
          Clear search
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Nothing here yet.</p>
    )

  return (
    <div>
      {/* ── Saved / preset views bar ── */}
      {hasViews && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {presetViews?.map((pv) => (
            <button
              key={pv.id}
              type="button"
              onClick={() => applyView({ globalFilter: pv.filter ?? "" })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                globalFilter === (pv.filter ?? "")
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {pv.label}
            </button>
          ))}
          {savedViewsKey && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs border-border/60 rounded-full">
                  <Bookmark className="h-3.5 w-3.5" /> Views
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2">
                <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saved views</p>
                {savedViews.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">No saved views yet.</p>}
                {savedViews.map((v) => (
                  <div key={v.name} className="flex items-center gap-1 rounded-md hover:bg-muted/60">
                    <button type="button" onClick={() => applyView(v)} className="flex-1 text-left px-2 py-1.5 text-sm truncate">
                      {v.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => persist(savedViews.filter((x) => x.name !== v.name))}
                      aria-label={`Delete view ${v.name}`}
                      className="p-1 text-muted-foreground hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-border/50">
                  <Input
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
                    placeholder="Save current as…"
                    className="h-7 text-xs"
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={saveCurrentView} disabled={!newViewName.trim()}>
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectable && selectedRows.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{selectedRows.length} selected</span>
            <button type="button" onClick={() => table.resetRowSelection()} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {bulkActions!.map((a) => (
              <Button
                key={a.label}
                variant={a.destructive ? "destructive" : "outline"}
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => a.onSelected(selectedRows)}
              >
                {a.icon && <a.icon className="h-3.5 w-3.5" />}
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0 w-full">
          {showSearch ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 w-full sm:max-w-sm shadow-sm focus-within:ring-1 focus-within:ring-ring transition-shadow">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
                placeholder={searchLabel}
                aria-label={searchLabel}
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value)
                  table.setPageIndex(0)
                }}
              />
            </div>
          ) : null}

          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {filteredRowCount === totalRowCount
              ? `${totalRowCount} result${totalRowCount !== 1 ? "s" : ""}`
              : `${filteredRowCount} of ${totalRowCount} results`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(val) => {
              table.setPageSize(Number(val))
              table.setPageIndex(0)
              writePageSize(Number(val))
            }}
          >
            <SelectTrigger className="h-8 w-[90px] text-xs border-border/60 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setCompact((c) => !c)}
            title={compact ? "Comfortable rows" : "Compact rows"}
            aria-label="Toggle row density"
            className={cn("h-8 w-8 border-border/60", compact && "bg-muted")}
          >
            <Rows3 className="h-3.5 w-3.5" />
          </Button>

          <Button variant="outline" size="sm" onClick={exportToCSV} className="h-8 gap-1.5 text-xs border-border/60">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/60">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((col) => col.getCanHide() && col.id !== "actions" && col.id !== "select")
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    className="text-xs capitalize"
                    checked={col.getIsVisible()}
                    onCheckedChange={(value) => col.toggleVisibility(!!value)}
                  >
                    {String(col.columnDef.header || col.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Mobile Cards ── */}
      {renderMobileCard && (
        <div className="grid grid-cols-1 gap-4 md:hidden">
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => <div key={row.id}>{renderMobileCard(row.original)}</div>)
          ) : (
            <div className="rounded-xl border bg-card/50 px-4 py-10 text-center shadow-sm">
              <EmptyRows />
            </div>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className={`rounded-xl border border-border/40 bg-card/50 shadow-sm overflow-x-auto ${renderMobileCard ? "hidden md:block" : ""}`}>
        <Table>
          <TableHeader className="bg-muted/40 border-b border-border/60 sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent border-border/60">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id} className={cn("text-xs font-medium text-muted-foreground", cellPad)}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 select-none hover:text-foreground transition-colors group"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3 text-foreground" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="h-3 w-3 text-foreground" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={cn(
                    "hover:bg-muted/40 data-[state=selected]:bg-primary/5 transition-colors border-b border-border/40 last:border-0",
                    onRowClick && "cursor-pointer focus-visible:outline-none focus-visible:bg-muted/60",
                  )}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={(e) => {
                    // A button, link, menu or checkbox inside the row does its
                    // own thing — it must not also open the row.
                    if (!onRowClick || isInteractive(e.target)) return
                    onRowClick(row.original)
                  }}
                  onKeyDown={(e) => {
                    if (onRowClick && e.key === "Enter" && e.target === e.currentTarget) onRowClick(row.original)
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn("text-sm", cellPad)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={tableColumns.length} className="h-32 text-center">
                  <EmptyRows />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination ── hidden when everything fits on one page. */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 py-4">
          <p className="text-xs text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground tabular-nums">
              {(currentPage - 1) * pagination.pageSize + 1}–{Math.min(currentPage * pagination.pageSize, filteredRowCount)}
            </span>{" "}
            of <span className="font-medium text-foreground tabular-nums">{filteredRowCount}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="h-8 gap-1 text-xs border-border/60"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="h-8 gap-1 text-xs border-border/60"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
