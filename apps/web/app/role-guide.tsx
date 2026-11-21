import type { Role } from "@mediledger/shared";

type Step = { title: string; instruction: string };

const workflows: Record<Role, Step[]> = {
  AUDITOR: [
    {
      title: "Open Audit history",
      instruction:
        "Review permitted registration, consent, and verification activity.",
    },
    {
      title: "Filter by event type",
      instruction:
        "Select a type to narrow the events and open Event details to inspect references.",
    },
    {
      title: "Check provenance",
      instruction:
        "Simulated events are labeled. Confirmed live ledger writes include Fabric transaction IDs.",
    },
  ],
  ISSUER: [
    {
      title: "Start a registration",
      instruction:
        "Select Register a report and choose the patient who should receive it.",
    },
    {
      title: "Upload the report",
      instruction:
        "Choose a synthetic PDF up to 5 MiB and select Register report.",
    },
    {
      title: "Confirm the handoff",
      instruction:
        "Open the report in Issued reports. It is now available to the selected patient.",
    },
  ],
  PATIENT: [
    {
      title: "Find your report",
      instruction:
        "Open My reports and select the PDF. Refresh the list if it was just registered.",
    },
    {
      title: "Share with a provider",
      instruction:
        "Select Grant access, search for the provider, and confirm your choice. Tell the provider which report to open.",
    },
    {
      title: "Manage access later",
      instruction:
        "Return to the report and select Revoke to stop future downloads. Review changes under Activity.",
    },
  ],
  PROVIDER: [
    {
      title: "Open a shared report",
      instruction:
        "Ask the patient to grant access, then refresh Shared reports and select the PDF.",
    },
    {
      title: "Get the registered copy",
      instruction:
        "Select Download PDF to get the copy registered by the issuing organization.",
    },
    {
      title: "Verify a PDF",
      instruction:
        "Under Verify a copy, choose the file you want to check and select Verify PDF. Read the Match or Mismatch result.",
    },
  ],
};

const seededIssuerSteps = [
  {
    title: "Open an issued report",
    instruction: "Select a pre-seeded report in Issued reports.",
  },
  {
    title: "Check the registration",
    instruction:
      "Open Activity to see when the report was registered. The patient can grant provider access from their workspace.",
  },
];

export function RoleGuide({
  role,
  canRegister,
}: {
  role: Role;
  canRegister: boolean;
}) {
  const steps =
    role === "ISSUER" && !canRegister ? seededIssuerSteps : workflows[role];
  return (
    <details className="card role-guide" open>
      <summary>Step-by-step guide</summary>
      <ol>
        {steps.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.instruction}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
