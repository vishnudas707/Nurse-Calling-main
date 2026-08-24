"use client";

import { Button, Label, TextInput } from "flowbite-react";

type HidListInputProps = {
  hids: string[];
  onChange: (hids: string[]) => void;
  disabled?: boolean;
};

/**
 * Repeatable Hardware ID rows - one organisation can own several devices.
 * Always renders at least one row so there is somewhere to type.
 */
export default function HidListInput({ hids, onChange, disabled }: HidListInputProps) {
  const rows = hids.length ? hids : [""];

  const setRow = (index: number, value: string) => {
    // Devices report 10-digit numeric ids, so keep the field numeric as typed.
    const digits = value.replace(/\D/g, "").slice(0, 10);
    onChange(rows.map((hid, i) => (i === index ? digits : hid)));
  };

  const addRow = () => onChange([...rows, ""]);

  const removeRow = (index: number) => {
    const remaining = rows.filter((_, i) => i !== index);
    onChange(remaining.length ? remaining : [""]);
  };

  return (
    <div>
      <Label htmlFor="hid-0">Hardware IDs (HID)</Label>
      <div className="mt-1 space-y-2">
        {rows.map((hid, index) => (
          <div key={index} className="flex items-center gap-2">
            <TextInput
              id={`hid-${index}`}
              name={`hid-${index}`}
              className="flex-1"
              value={hid}
              onChange={(e) => setRow(index, e.target.value)}
              placeholder="10-digit device ID"
              inputMode="numeric"
              maxLength={10}
              disabled={disabled}
            />
            <Button
              type="button"
              color="gray"
              size="sm"
              onClick={() => removeRow(index)}
              disabled={disabled || (rows.length === 1 && !hid)}
              aria-label={`Remove hardware ID ${index + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" color="light" size="sm" onClick={addRow} disabled={disabled}>
          + Add another HID
        </Button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Add one row per device. Leave blank if the organisation has no device yet.
        </span>
      </div>
    </div>
  );
}
