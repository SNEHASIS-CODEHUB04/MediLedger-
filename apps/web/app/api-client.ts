import type {
  Mode,
  RecordSummary,
  SessionProfile,
  WorkspaceEvent,
  WorkspaceMetrics,
  StaffMember,
  VerificationAttempt,
  AuditEvent,
} from "@mediledger/shared";

const endpoint = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

export type Health = { mode: Mode; database: boolean; ledger: string };
export type DirectoryEntry = {
  id: string;
  organization: { name: string };
  active?: boolean;
};
export type RecordDetail = RecordSummary & { grants: string[] };
export type Page<T, Cursor = number> = { items: T[]; next: Cursor | null };

type ApiRoutes = {
  "/auth/login": { token: string };
  "/auth/demo": { token: string };
  "/users/me": SessionProfile;
  "/users/directory": DirectoryEntry[];
  "/workspace/overview": WorkspaceMetrics;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    payload: { message?: string | string[] } | null,
  ) {
    super(
      [payload?.message].flat().filter(Boolean).join(" ") ||
        (status === 401
          ? "Please sign in again."
          : "Request failed (" + status + ")"),
    );
  }
}

export async function request(
  path: string,
  token = "",
  options: RequestInit = {},
) {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(endpoint + path, {
    ...options,
    headers,
    cache: "no-store",
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      await response.json().catch(() => null),
    );
  return response;
}

export async function read<T>(
  path: string,
  token = "",
  options?: RequestInit,
): Promise<T> {
  return (await request(path, token, options)).json();
}

export function route<P extends keyof ApiRoutes>(
  path: P,
  token?: string,
  options?: RequestInit,
): Promise<ApiRoutes[P]> {
  return read(path, token, options);
}

export function record(id: string, token: string) {
  const path = "/records/" + encodeURIComponent(id);
  return Promise.all([
    read<RecordDetail>(path, token),
    read<AuditEvent[]>(path + "/history", token),
  ]);
}

function query(
  path: string,
  values: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return path + "?" + params.toString();
}

export const records = (token: string, search?: string, cursor?: string) =>
  read<Page<RecordSummary, string>>(
    query("/records", { search, cursor }),
    token,
  );
export const staff = (token: string, offset?: number) =>
  read<Page<StaffMember>>(query("/workspace/staff", { offset }), token);
export const audit = (token: string, action?: string, offset?: number) =>
  read<Page<WorkspaceEvent>>(
    query("/workspace/audit", { action, offset }),
    token,
  );
export const attempts = (token: string, offset?: number) =>
  read<Page<VerificationAttempt>>(
    query("/workspace/verifications", { offset }),
    token,
  );

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch(endpoint + "/health", {
    signal,
    cache: "no-store",
  });
  return response.json();
}

export const json = (value: object, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

export function upload<T>(
  path: string,
  token: string,
  data: FormData,
  progress: (value: number) => void,
) {
  const file = data.get("file");
  if (
    !(file instanceof File) ||
    !/\.pdf$/i.test(file.name) ||
    (file.type && file.type !== "application/pdf") ||
    file.size === 0 ||
    file.size > 5 * 1024 * 1024
  ) {
    return Promise.reject(new Error("Choose a PDF no larger than 5 MiB."));
  }
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint + path);
    xhr.responseType = "json";
    xhr.timeout = 60_000;
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        progress(Math.floor((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new ApiError(xhr.status, xhr.response));
    });
    for (const event of ["error", "timeout", "abort"])
      xhr.addEventListener(event, () =>
        reject(
          new Error(
            "The upload did not finish. Check your connection and try again.",
          ),
        ),
      );
    progress(0);
    xhr.send(data);
  });
}
