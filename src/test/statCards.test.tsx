import { render, screen, fireEvent } from "@testing-library/react";
import { CheckCircle2, Clock } from "lucide-react";
import { StatCards } from "@/components/admin/StatCards";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { WorkspaceContext } from "@/components/admin/core/workspaceContext";

describe("StatCards", () => {
  it("renders lucide icons passed as components (forwardRef objects)", () => {
    // The old check was `typeof icon === "function"`, which lucide's
    // forwardRef icons fail — every KPI showed an empty icon tile.
    const { container } = render(
      <StatCards items={[{ label: "Active", value: 5, icon: CheckCircle2 }, { label: "Pending", value: 0, icon: Clock }]} />,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("sizes the grid to the card count so no row ends in an empty slot", () => {
    const three = render(<StatCards items={[{ label: "a", value: 1 }, { label: "b", value: 2 }, { label: "c", value: 3 }]} />);
    expect(three.container.firstElementChild?.className).toContain("md:grid-cols-3");
    expect(three.container.firstElementChild?.className).not.toContain("grid-cols-4");

    const six = render(<StatCards items={Array.from({ length: 6 }, (_, i) => ({ label: `k${i}`, value: i }))} />);
    expect(six.container.firstElementChild?.className).toContain("xl:grid-cols-6");
  });

  it("mutes zero values instead of showing them in an alarm colour", () => {
    render(<StatCards items={[{ label: "Blocked", value: 0, tone: "text-rose-600" }, { label: "Lapsed", value: 4, tone: "text-amber-600" }]} />);
    expect(screen.getByText("0").className).not.toContain("text-rose-600");
    expect(screen.getByText("4").className).toContain("text-amber-600");
  });

  it("makes cards with onClick into buttons that report their active state", () => {
    const onClick = vi.fn();
    render(<StatCards items={[{ label: "No zone", value: 3, onClick, active: true }]} />);
    const btn = screen.getByRole("button", { name: /no zone/i });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("AdminPageHeader", () => {
  it("is the page h1 on its own route", () => {
    render(<AdminPageHeader title="Dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  });

  it("steps down to an h2 inside a workspace so titles never stack", () => {
    render(
      <WorkspaceContext.Provider value={true}>
        <AdminPageHeader title="Vendor directory" />
      </WorkspaceContext.Provider>,
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Vendor directory" })).toBeTruthy();
  });
});
