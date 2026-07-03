import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useId } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function PreferencesSection() {
  const { theme, setTheme } = useTheme();
  const name = useId();
  const active = theme ?? "system";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how the register looks. System follows your device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">Theme</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {OPTIONS.map((opt) => {
                const selected = active === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      "relative flex cursor-pointer flex-col items-center gap-3 rounded-lg border p-5 text-sm font-medium transition-colors",
                      "hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                      selected
                        ? "border-primary bg-accent/40 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name={name}
                      value={opt.value}
                      checked={selected}
                      onChange={() => setTheme(opt.value)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "flex size-10 items-center justify-center rounded-full",
                        selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <opt.icon className="size-5" aria-hidden="true" />
                    </span>
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
