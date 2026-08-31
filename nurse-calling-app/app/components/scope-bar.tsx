"use client";

import type { Scope, ScopeOptions } from "../lib/scope";

type ScopeBarProps = {
  scope: Scope;
  onChange: (next: Scope) => void;
  options: ScopeOptions;
  /** Shown on the left, e.g. "Top" / "Bottom" on the split dashboard. */
  label?: string;
  /** Extra text on the right, e.g. a count of what the scope currently holds. */
  hint?: string;
  compact?: boolean;
};

/**
 * Picks the device or floor a page is narrowed to. Renders nothing when the
 * organisation has one device and no floors worth splitting by - a single-ward
 * site should never see a control with one option in it.
 */
export default function ScopeBar({
  scope,
  onChange,
  options,
  label,
  hint,
  compact = false,
}: ScopeBarProps) {
  const { hids, floors, isLoading } = options;
  const canSplit = hids.length > 1 || floors.length > 1;
  if (isLoading || !canSplit) return null;

  const values = scope.basis === "hid" ? hids : floors;
  const valueLabel = scope.basis === "hid" ? "device" : "floor";

  const selectClass =
    "rounded-lg border border-gray-300 bg-gray-50 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white " +
    (compact ? "px-2 py-1 text-sm" : "px-3 py-2 text-sm");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      {label ? (
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
      ) : null}

      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600 dark:text-gray-400">View by</label>
        <select
          aria-label="View by"
          className={selectClass}
          value={scope.basis}
          onChange={(e) =>
            // Switching basis resets to All: a floor number is not a valid HID.
            onChange({ basis: e.target.value as Scope["basis"], value: "" })
          }
        >
          {hids.length > 1 ? <option value="hid">Hardware ID</option> : null}
          {floors.length > 1 ? <option value="floor">Floor</option> : null}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <select
          aria-label={`Select ${valueLabel}`}
          className={selectClass}
          value={scope.value}
          onChange={(e) => onChange({ basis: scope.basis, value: e.target.value })}
        >
          <option value="">{scope.basis === "hid" ? "All devices" : "All floors"}</option>
          {values.map((value) => (
            <option key={value} value={value}>
              {scope.basis === "hid" ? value : `Floor ${value}`}
            </option>
          ))}
        </select>
      </div>

      {hint ? (
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">{hint}</span>
      ) : null}
    </div>
  );
}
