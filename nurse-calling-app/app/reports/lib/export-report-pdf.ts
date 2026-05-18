import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function exportCallsPerDayPdf(rows: { day: string; count: number }[]) {
  const doc = new jsPDF();
  doc.text("Calls per Day Report", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Date", "Count"]],
    body: rows.map((r) => [r.day, String(r.count)]),
  });
  doc.save("calls_per_day.pdf");
}

export function exportCallsPerRoomPdf(rows: { room: string; count: number }[]) {
  const doc = new jsPDF();
  doc.text("Calls per Room Report", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Room", "Count"]],
    body: rows.map((r) => [r.room, String(r.count)]),
  });
  doc.save("calls_per_room.pdf");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exportAttendingLagPdf(rows: any[], lagThresholdMinutes: number) {
  const doc = new jsPDF();
  doc.text(`Attending Lag Report (> ${lagThresholdMinutes} minutes)`, 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Call ID", "Room", "Created", "Reset", "Lag (min)"]],
    body: rows.map((c) => [
      c.id,
      c.roomName || "",
      c.timestamp ? new Date(c.timestamp).toLocaleString() : "",
      c.dateTimeReset ? new Date(c.dateTimeReset).toLocaleString() : "",
      String(c.lagMinutes ?? ""),
    ]),
  });
  doc.save("attending_lag.pdf");
}
