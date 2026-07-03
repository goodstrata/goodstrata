import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

/** Same shape the register enforces (index.tsx), with friendlier framing. */
const welcomeSchema = z.object({
  name: z.string().min(3, "Give your building a name (at least 3 characters)."),
  planOfSubdivision: z.string().regex(/^PS\d{5,6}[A-Z]?$/i, "Plan numbers look like PS543210V."),
  addressLine1: z.string().min(3, "Enter the street address."),
  suburb: z.string().min(2, "Enter the suburb."),
  postcode: z.string().regex(/^\d{4}$/, "Victorian postcodes have 4 digits."),
});

export interface CreatedScheme {
  id: string;
  name: string;
}

export function WelcomeStep({
  defaultName,
  onCreated,
}: {
  defaultName: string;
  onCreated: (scheme: CreatedScheme) => void;
}) {
  const queryClient = useQueryClient();
  const form = useAppForm({
    schema: welcomeSchema,
    defaultValues: {
      name: defaultName,
      planOfSubdivision: "",
      addressLine1: "",
      suburb: "",
      postcode: "",
    },
    onSubmit: async (values) => {
      const { scheme } = await unwrap<{ scheme: CreatedScheme }>(
        await api.schemes.$post({ json: { ...values, state: "VIC" } }),
      );
      await queryClient.invalidateQueries({ queryKey: ["schemes"] });
      onCreated({ id: scheme.id, name: scheme.name });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-medium tracking-tight md:text-[1.75rem]">
          Welcome — let's set up your building
        </h1>
        <p className="text-sm text-muted-foreground">
          Register your owners corporation from the plan of subdivision. It only takes a minute, and
          you can refine the details later.
        </p>
      </div>

      <form
        id="onboarding-welcome-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <form.Field name="name">
          {(field) => (
            <Field
              label="Building name"
              htmlFor="welcome-name"
              required
              hint="What everyone calls it — usually the street address."
              error={fieldError(field.state.meta.errors)}
            >
              <Input
                placeholder="e.g. 48 Rose St Owners Corporation"
                autoComplete="organization"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="planOfSubdivision">
          {(field) => (
            <Field
              label="Plan of subdivision"
              htmlFor="welcome-plan"
              required
              hint="From your plan or title — the number that identifies the scheme."
              error={fieldError(field.state.meta.errors)}
            >
              <Input
                placeholder="e.g. PS543210V"
                autoCapitalize="characters"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="addressLine1">
          {(field) => (
            <Field
              label="Street address"
              htmlFor="welcome-address"
              required
              error={fieldError(field.state.meta.errors)}
            >
              <Input
                placeholder="Street address"
                autoComplete="address-line1"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <form.Field name="suburb">
            {(field) => (
              <Field
                label="Suburb"
                htmlFor="welcome-suburb"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="Suburb"
                  autoComplete="address-level2"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="postcode">
            {(field) => (
              <Field
                label="Postcode"
                htmlFor="welcome-postcode"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="Postcode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <FormError form={form} />

        <div className="flex justify-end">
          <SubmitButton form={form} formId="onboarding-welcome-form" size="lg">
            Create building & continue
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
