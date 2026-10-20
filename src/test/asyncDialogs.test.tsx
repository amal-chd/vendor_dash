import { render, screen, fireEvent, act } from "@testing-library/react";
import { AsyncDialogHost, confirmDialog, promptDialog } from "@/components/admin/core/asyncDialogs";

describe("asyncDialogs", () => {
  it("confirmDialog resolves true on confirm and false on cancel", async () => {
    render(<AsyncDialogHost />);

    let first!: Promise<boolean>;
    act(() => {
      first = confirmDialog({ title: "Delete this zone?", confirmLabel: "Delete", destructive: true });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await expect(first).resolves.toBe(true);

    let second!: Promise<boolean>;
    act(() => {
      second = confirmDialog({ title: "Delete that zone?" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBe(false);
  });

  it("promptDialog blocks confirm until the value is valid, then returns it trimmed", async () => {
    render(<AsyncDialogHost />);

    let answer!: Promise<string | null>;
    act(() => {
      answer = promptDialog({
        title: "Adjust wallet",
        label: "Amount",
        required: true,
        validate: (v) => (Number(v) ? null : "Enter a non-zero amount."),
        confirmLabel: "Next",
      });
    });
    const next = await screen.findByRole("button", { name: "Next" });
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
    expect(screen.getByText("Enter a non-zero amount.")).toBeTruthy();
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: " 150 " } });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(next);
    await expect(answer).resolves.toBe("150");
  });

  it("queues dialogs so a second request waits for the first", async () => {
    render(<AsyncDialogHost />);
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    act(() => {
      a = confirmDialog({ title: "First?", confirmLabel: "Yes A" });
      b = confirmDialog({ title: "Second?", confirmLabel: "Yes B" });
    });
    expect(await screen.findByText("First?")).toBeTruthy();
    expect(screen.queryByText("Second?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes A" }));
    await expect(a).resolves.toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Yes B" }));
    await expect(b).resolves.toBe(true);
  });
});
