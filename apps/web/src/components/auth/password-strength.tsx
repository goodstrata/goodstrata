import { cn } from "@/lib/utils";

interface Strength {
  /** 0 = empty, 1 weak → 4 strong. */
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: string;
}

/**
 * Cheap client-side strength read for the signup hint. Not a gate — the schema
 * enforces the 8-char minimum; this just nudges toward something better.
 */
export function scorePassword(pw: string): Strength {
  if (!pw) return { level: 0, label: "", tone: "" };
  let raw = 0;
  if (pw.length >= 8) raw++;
  if (pw.length >= 12) raw++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) raw++;
  if (/\d/.test(pw)) raw++;
  if (/[^A-Za-z0-9]/.test(pw)) raw++;
  // A sub-minimum password can never read above "weak".
  const level = (pw.length < 8 ? 1 : Math.min(4, Math.max(1, raw))) as 1 | 2 | 3 | 4;
  const meta = {
    1: { label: "Weak", tone: "critical" },
    2: { label: "Fair", tone: "caution" },
    3: { label: "Good", tone: "info" },
    4: { label: "Strong", tone: "positive" },
  }[level];
  return { level, ...meta };
}

/** Four-segment meter + label, rendered under the signup password field. */
export function PasswordStrength({ password }: { password: string }) {
  const { level, label, tone } = scorePassword(password);
  if (level === 0) return null;

  const fill =
    tone === "critical"
      ? "bg-critical"
      : tone === "caution"
        ? "bg-caution"
        : tone === "info"
          ? "bg-info"
          : "bg-positive";
  const text =
    tone === "critical"
      ? "text-critical"
      : tone === "caution"
        ? "text-caution"
        : tone === "info"
          ? "text-info"
          : "text-positive";

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((seg) => (
          <span
            key={seg}
            className={cn("h-1 flex-1 rounded-full", seg <= level ? fill : "bg-border")}
          />
        ))}
      </div>
      <p className="text-13 text-muted-foreground">
        Password strength: <span className={cn("font-medium", text)}>{label}</span>
      </p>
    </div>
  );
}
