import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "../lib/api";
import { useSession } from "../lib/auth";

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

  if (isPending) return <p className="text-gray-500">Loading…</p>;
  if (!session?.user) {
    void navigate({ to: "/login" });
    return null;
  }
  return <SchemeList />;
}

function SchemeList() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["schemes"],
    queryFn: async () => unwrap<{ schemes: SchemeRow[] }>(await api.schemes.$get()),
  });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your schemes</h1>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800"
        >
          New scheme
        </button>
      </div>

      {showCreate && (
        <CreateSchemeForm
          onCreated={() => {
            setShowCreate(false);
            void queryClient.invalidateQueries({ queryKey: ["schemes"] });
          }}
        />
      )}

      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {data?.schemes.length === 0 && (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-gray-500">
            No schemes yet. Create your owners corporation to get started.
          </p>
        )}
        {data?.schemes.map(({ scheme, roles }) => (
          <Link
            key={scheme.id}
            to="/schemes/$schemeId"
            params={{ schemeId: scheme.id }}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-600"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{scheme.name}</p>
                <p className="text-sm text-gray-500">
                  {scheme.planOfSubdivision} · {scheme.suburb} · Tier {scheme.tier}
                </p>
              </div>
              <div className="text-right text-sm">
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-brand-800">
                  {roles.join(" · ")}
                </span>
                <p className="mt-1 text-gray-400">{scheme.status}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CreateSchemeForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "",
    planOfSubdivision: "",
    addressLine1: "",
    suburb: "",
    postcode: "",
  });
  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.schemes.$post({ json: { ...form, state: "VIC" } })),
    onSuccess: onCreated,
  });

  const field = (key: keyof typeof form, placeholder: string) => (
    <input
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      placeholder={placeholder}
      required
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4"
    >
      {field("name", "Scheme name (e.g. 48 Rose St Owners Corporation)")}
      {field("planOfSubdivision", "Plan of subdivision (e.g. PS543210V)")}
      {field("addressLine1", "Street address")}
      <div className="grid grid-cols-2 gap-3">
        {field("suburb", "Suburb")}
        {field("postcode", "Postcode")}
      </div>
      {mutation.error && <p className="text-sm text-red-600">{mutation.error.message}</p>}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {mutation.isPending ? "Creating…" : "Create scheme"}
      </button>
    </form>
  );
}
