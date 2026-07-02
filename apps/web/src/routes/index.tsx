import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: HomePage,
});

interface SchemeRow {
  scheme: {
    id: string;
    name: string;
    planOfSubdivision: string;
    suburb: string;
    status: string;
    tier: number;
  };
  roles: string[];
}

function HomePage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (!session?.user) {
    void navigate({ to: "/login" });
    return null;
  }
  return <SchemeList />;
}

function SchemeList() {
  const { data, isLoading } = useQuery({
    queryKey: ["schemes"],
    queryFn: async () => unwrap<{ schemes: SchemeRow[] }>(await api.schemes.$get()),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your schemes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Owners corporations you manage or belong to.
          </p>
        </div>
        <CreateSchemeDialog />
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}

      {data?.schemes.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
          <Building2 className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No schemes yet. Create your owners corporation to get started.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {data?.schemes.map(({ scheme, roles }) => (
          <Link
            key={scheme.id}
            to="/schemes/$schemeId"
            params={{ schemeId: scheme.id }}
            className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full gap-3 transition-colors group-hover:border-brand-600/60">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base leading-snug">{scheme.name}</CardTitle>
                  <StatusBadge status={scheme.status} />
                </div>
                <CardDescription>
                  {scheme.planOfSubdivision} · {scheme.suburb} · Tier {scheme.tier}
                </CardDescription>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {roles.map((role) => (
                    <Badge key={role} variant="secondary" className="bg-brand-50 text-brand-800">
                      {role.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CreateSchemeDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    planOfSubdivision: "",
    addressLine1: "",
    suburb: "",
    postcode: "",
  });
  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.schemes.$post({ json: { ...form, state: "VIC" } })),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", planOfSubdivision: "", addressLine1: "", suburb: "", postcode: "" });
      toast.success("Scheme created");
      void queryClient.invalidateQueries({ queryKey: ["schemes"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`scheme-${key}`}>{label}</Label>
      <Input
        id={`scheme-${key}`}
        placeholder={placeholder}
        required
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New scheme
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register an owners corporation</DialogTitle>
          <DialogDescription>
            Enter the details from the plan of subdivision to get started.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-scheme-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          {field("name", "Scheme name", "Scheme name (e.g. 48 Rose St Owners Corporation)")}
          {field(
            "planOfSubdivision",
            "Plan of subdivision",
            "Plan of subdivision (e.g. PS543210V)",
          )}
          {field("addressLine1", "Street address", "Street address")}
          <div className="grid grid-cols-2 gap-3">
            {field("suburb", "Suburb", "Suburb")}
            {field("postcode", "Postcode", "Postcode")}
          </div>
          {mutation.error && <p className="text-sm text-destructive">{mutation.error.message}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="create-scheme-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create scheme"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
